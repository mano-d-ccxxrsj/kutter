use crate::middlewares::verify_token;
use actix_web::{Error, HttpRequest, HttpResponse, get, web};
use actix_ws::{Message, Session};
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::select;
use tokio::sync::{RwLock, broadcast};

pub async fn friend_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
            CREATE TABLE IF NOT EXISTS friends (
                id SERIAL PRIMARY KEY,
                sender_username VARCHAR(255) NOT NULL REFERENCES users(username),
                receiver_username VARCHAR(255) NOT NULL REFERENCES users(username),
                status VARCHAR(255) NOT NULL
            )
            "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Friends {
    pub id: Option<i32>,
    pub sender_username: String,
    pub receiver_username: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FriendRequestPayload {
    pub receiver_username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FriendRequestStatus {
    pub id: i32,
    pub sender_username: String,
    pub receiver_username: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CancelFriendRequest {
    pub friend_req_id: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSocketMessage {
    pub action: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum FriendAction {
    SendRequest(Friends),
    Accept(FriendRequestStatus),
    Cancel(CancelFriendRequest),
}

#[derive(Debug, Clone)]
pub struct UserSession {
    pub email: String,
    pub username: String,
    pub tx: broadcast::Sender<FriendAction>,
}

pub struct FriendAppState {
    pub db_pool: PgPool,
    pub tx: broadcast::Sender<FriendAction>,
    pub user_sessions: Arc<RwLock<HashMap<String, UserSession>>>,
}

// routes
#[get("/ws/friend_req")]
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<Arc<FriendAppState>>,
) -> Result<HttpResponse, Error> {
    let token = match req.cookie("token") {
        Some(token) => token.value().to_string(),
        None => return Ok(HttpResponse::Unauthorized().finish()),
    };

    let claims = match verify_token(token) {
        Ok(claims) => claims,
        Err(_) => return Ok(HttpResponse::Unauthorized().finish()),
    };

    let username = claims.email.clone();
    let email = claims.sub.clone();

    let (response, session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let db_pool = state.db_pool.clone();
    let second_spawn_db_pool = db_pool.clone();
    let tx = state.tx.clone();
    let mut rx = tx.subscribe();

    let mut broadcast_session = session.clone();
    let mut message_session = session.clone();

    let user_sessions = state.user_sessions.clone();
    let broadcast_session_username = username.clone();
    {
        let mut sessions = user_sessions.write().await;
        sessions.insert(
            email.clone(),
            UserSession {
                email: email.clone(),
                username: username.clone(),
                tx: tx.clone(),
            },
        );
    }
    let broadcast_user_sessions = user_sessions.clone();
    let broadcast_email = email.clone();

    actix_rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(ws_msg) = serde_json::from_str::<WebSocketMessage>(&text) {
                        match ws_msg.action.as_str() {
                            "send_request" => {
                                if let Ok(req) =
                                    serde_json::from_value::<FriendRequestPayload>(ws_msg.payload)
                                {
                                    let new_friend = Friends {
                                        id: None,
                                        sender_username: username.clone(),
                                        receiver_username: req.receiver_username.clone(),
                                        status: "pending".to_string(),
                                    };

                                    let user_exists = match sqlx::query_scalar::<_, bool>(
                                        "SELECT EXISTS(SELECT * FROM users WHERE username = $1)",
                                    )
                                    .bind(&new_friend.receiver_username)
                                    .fetch_one(&db_pool)
                                    .await
                                    {
                                        Ok(user_exists) => user_exists,
                                        Err(e) => {
                                            eprintln!("Error checking if user exists: {}", e);
                                            ws_error_message(
                                                &mut message_session,
                                                "Error checking if user exists",
                                            )
                                            .await;
                                            return;
                                        }
                                    };

                                    let already_sent = match sqlx::query_scalar::<_, bool>(
                                            "SELECT EXISTS(SELECT * FROM friends WHERE (sender_username = $1 AND receiver_username = $2) OR (sender_username = $2 AND receiver_username = $1))",
                                        )
                                        .bind(&new_friend.sender_username)
                                        .bind(&new_friend.receiver_username)
                                        .fetch_one(&db_pool)
                                        .await {
                                            Ok(already_sent) => already_sent,
                                            Err(e) => {
                                                eprintln!("Error checking if friend request already exists: {}", e);
                                                ws_error_message(&mut message_session, "Error checking if friend request already exists").await;
                                                return;
                                            }
                                        };

                                    let send_to_itself =
                                        new_friend.sender_username == new_friend.receiver_username;

                                    if send_to_itself {
                                        ws_error_message(
                                            &mut message_session,
                                            "You can't send message to yourself",
                                        )
                                        .await;
                                        return;
                                    }

                                    if already_sent {
                                        ws_error_message(
                                            &mut message_session,
                                            "Friend request already sent or received",
                                        )
                                        .await;
                                        return;
                                    }

                                    if !user_exists {
                                        ws_error_message(&mut message_session, "User not found")
                                            .await;
                                        return;
                                    }

                                    match sqlx::query_as::<_, Friends>(
                                            "INSERT INTO friends (sender_username, receiver_username, status) VALUES ($1, $2, 'pending') RETURNING *",
                                        )
                                        .bind(&new_friend.sender_username)
                                        .bind(&new_friend.receiver_username)
                                        .fetch_one(&db_pool)
                                        .await
                                        {
                                            Ok(friend) => {
                                                let _ = tx.send(FriendAction::SendRequest(friend));
                                            }
                                            Err(e) => {
                                                eprintln!("Error creating friend request: {}", e);
                                                ws_error_message(&mut message_session, "Error creating friend request").await;
                                            }
                                        }
                                }
                            }

                            "cancel" => {
                                if let Some(friend_req_id) =
                                    ws_msg.payload.get("friend_req_id").and_then(|v| v.as_i64())
                                {
                                    let id_i32 = friend_req_id as i32;

                                    let can_cancel = match sqlx::query_as::<_, Friends>(
                                            "SELECT * FROM friends WHERE id = $1 AND (receiver_username = $2 OR sender_username = $2)"
                                        )
                                        .bind(&id_i32)
                                        .bind(&username)
                                        .fetch_all(&db_pool)
                                        .await
                                        {
                                            Ok(_) => true,
                                            Err(_) => false
                                        };

                                    if can_cancel {
                                        match sqlx::query("DELETE FROM friends WHERE id = $1")
                                            .bind(&id_i32)
                                            .execute(&db_pool)
                                            .await
                                        {
                                            Ok(_) => {
                                                let _ = tx.send(FriendAction::Cancel(
                                                    CancelFriendRequest {
                                                        friend_req_id: id_i32,
                                                    },
                                                ));
                                            }
                                            Err(e) => {
                                                println!("Error deleting friend: {}", e);
                                                ws_error_message(
                                                    &mut message_session,
                                                    "Error deleting friend",
                                                )
                                                .await;
                                            }
                                        }
                                    }
                                }
                            }

                            "accept" => {
                                if let Some(friend_id) =
                                    ws_msg.payload.get("friend_id").and_then(|v| v.as_i64())
                                {
                                    let receiver = username.clone();
                                    let is_receiver = match sqlx::query_scalar::<_, bool>(
                                            "SELECT EXISTS(SELECT * FROM friends WHERE (id = $1 AND receiver_username = $2))"
                                        )
                                        .bind(friend_id as i32)
                                        .bind(&receiver)
                                        .fetch_one(&db_pool)
                                        .await
                                        {
                                            Ok(is_receiver) => is_receiver,
                                            Err(e) => {
                                                eprintln!("Error checking if user is receiver: {}", e);
                                                ws_error_message(&mut message_session, "Error checking if user is receiver").await;
                                                return;
                                            }
                                        };

                                    let sender: String = match sqlx::query_scalar(
                                        "SELECT sender_username FROM friends WHERE id = $1",
                                    )
                                    .bind(friend_id as i32)
                                    .fetch_one(&db_pool)
                                    .await
                                    {
                                        Ok(sender) => sender,
                                        Err(e) => {
                                            eprintln!("Failed to get sender: {}", e);
                                            ws_error_message(
                                                &mut message_session,
                                                "Failed to get sender",
                                            )
                                            .await;
                                            return;
                                        }
                                    };

                                    if !is_receiver {
                                        ws_error_message(
                                            &mut message_session,
                                            "You can accept your own friend request",
                                        )
                                        .await;
                                        return;
                                    }

                                    match sqlx::query_as::<_, Friends>(
                                            "UPDATE friends SET status = 'accepted' WHERE id = $1 RETURNING *",
                                        )
                                        .bind(friend_id as i32)
                                        .fetch_one(&db_pool)
                                        .await
                                        {
                                            Ok(friend) => {
                                                let status = FriendRequestStatus {
                                                    id: friend.id.unwrap(),
                                                    sender_username: sender,
                                                    receiver_username: receiver,
                                                    status: "accepted".to_string(),
                                                };
                                                let _ = tx.send(FriendAction::Accept(status));
                                            }
                                            Err(e) => {
                                                eprintln!("Error accepting friend request: {}", e);
                                                ws_error_message(&mut message_session, "Error accepting friend request").await;
                                            }
                                        }
                                }
                            }

                            _ => {
                                eprintln!("Unknown action: {}", ws_msg.action);
                                ws_error_message(&mut message_session, "Unknown action").await;
                            }
                        }
                    } else {
                        eprintln!("Failed to parse WebSocket message: {}", text);
                    }
                }
                Message::Close(_) => {
                    {
                        let mut sessions = user_sessions.write().await;
                        sessions.remove(&email);
                    }
                    println!("(friend.rs): session closed and removed.");
                    break;
                }
                _ => {
                    {
                        let mut sessions = user_sessions.write().await;
                        sessions.remove(&email);
                    }
                    println!("(friend.rs): session closed and removed.");
                    break;
                }
            }
        }
    });

    actix_rt::spawn(async move {
        let mut session_alive = true;

        while session_alive {
            select! {
                msg = rx.recv() => {
                    match msg {
                        Ok(msg) => {
                            let session_still_alive = {
                                let sessions = broadcast_user_sessions.read().await;
                                sessions.contains_key(&broadcast_email)
                            };

                            if !session_still_alive {
                                session_alive = false;
                                continue;
                            }

                            let should_send = match &msg {
                                            FriendAction::SendRequest(friend) => {
                                                broadcast_session_username == friend.receiver_username
                                                || broadcast_session_username == friend.sender_username
                                            }
                                            FriendAction::Accept(status) => {
                                                match sqlx::query_as::<_, Friends>(
                                                    "SELECT * FROM friends WHERE id = $1 AND (sender_username = $2 OR receiver_username = $2)"
                                                )
                                                .bind(status.id)
                                                .bind(&broadcast_session_username)
                                                .fetch_optional(&second_spawn_db_pool)
                                                .await {
                                                    Ok(Some(_)) => true,
                                                    Ok(None) => false,
                                                    Err(_) => false
                                                }
                                            }
                                            FriendAction::Cancel(_) => true
                                        };

                            if should_send {
                                if let Err(_) = broadcast_session
                                    .text(serde_json::to_string(&msg).unwrap())
                                    .await
                                {
                                    session_alive = false;
                                }
                            }
                        }
                        Err(_) => {
                            session_alive = false;
                        }
                    }
                }

                _ = async {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
                    loop {
                        interval.tick().await;
                        let sessions = broadcast_user_sessions.read().await;
                        if !sessions.contains_key(&broadcast_email) {
                            break;
                        }
                    }
                } => {
                    session_alive = false;
                }
            }
        }
    });
    Ok(response)
}

impl FriendAppState {
    pub fn new(db_pool: PgPool) -> Self {
        let (tx, _) = broadcast::channel::<FriendAction>(20);
        FriendAppState {
            db_pool,
            tx,
            user_sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[get("/friend_req")]
pub async fn get_friend_req(
    state: web::Data<Arc<FriendAppState>>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let token = match req.cookie("token") {
        Some(token) => token.value().to_string(),
        None => return Ok(HttpResponse::Unauthorized().finish()),
    };

    let claims = match verify_token(token) {
        Ok(claims) => claims,
        Err(_) => return Ok(HttpResponse::Unauthorized().finish()),
    };

    let username = claims.email.clone();

    match sqlx::query_as::<_, Friends>(
        "SELECT * FROM friends WHERE sender_username = $1 OR receiver_username = $1",
    )
    .bind(username)
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(friends) => return Ok(HttpResponse::Ok().json(friends)),
        Err(e) => {
            println!("{:?}", e);
            return Ok(HttpResponse::InternalServerError().json("Failed to fetch friend request"));
        }
    }
}

async fn ws_error_message(message_session: &mut Session, message: &str) {
    let error_msg = WebSocketMessage {
        action: "error".to_string(),
        payload: serde_json::json!({"message": &message}),
    };
    if let Ok(error_json) = serde_json::to_string(&error_msg) {
        let _ = message_session.text(error_json).await;
    }
}
