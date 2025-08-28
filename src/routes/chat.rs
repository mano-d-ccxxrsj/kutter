use crate::middlewares::verify_token;
use actix_web::{Error, HttpRequest, HttpResponse, get, web};
use actix_ws::Message;
use chrono::{DateTime, Utc};
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::{
    select,
    sync::{RwLock, broadcast},
};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChatMessage {
    pub id: Option<i32>,
    pub chat_id: Option<i32>,
    pub email: String,
    pub username: String,
    pub message: String,
    pub replied_user: Option<String>,
    pub replied_message: Option<String>,
    pub time: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Chat {
    pub id: i32,
    pub first_user_name: String,
    pub second_user_name: String,
    pub last_update: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewMessage {
    pub message: String,
    pub chat_partner: Option<String>,
    pub reply: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewChat {
    pub second_user_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSocketMessage {
    pub action: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct DeleteMessageRequest {
    pub id: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum OutgoingMessage {
    NewMessage(ChatMessage),
    Delete { message_id: i32 },
    NewChat(Chat),
}

#[derive(Debug, Clone)]
pub struct UserSession {
    pub email: String,
    pub username: String,
    pub user_chats: Vec<i32>,
    pub tx: broadcast::Sender<OutgoingMessage>,
}

pub struct AppState {
    pub db_pool: PgPool,
    pub tx: broadcast::Sender<OutgoingMessage>,
    pub user_sessions: Arc<RwLock<HashMap<String, UserSession>>>,
}

pub async fn create_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            chat_id INTEGER NOT NULL REFERENCES chats(id),
            email VARCHAR(255) NOT NULL REFERENCES users(email),
            username VARCHAR(255) NOT NULL REFERENCES users(username),
            message TEXT NOT NULL,
            replied_user TEXT,
            replied_message TEXT,
            time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn chats(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chats (
            id SERIAL PRIMARY KEY,
            first_user_name VARCHAR(255) NOT NULL REFERENCES users(username),
            second_user_name VARCHAR(255) NOT NULL REFERENCES users(username),
            last_update TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_chat_pair UNIQUE (first_user_name, second_user_name)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE OR REPLACE FUNCTION enforce_chat_order() RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.first_user_name > NEW.second_user_name THEN
                DECLARE
                    temp VARCHAR(255);
                BEGIN
                    temp := NEW.first_user_name;
                    NEW.first_user_name := NEW.second_user_name;
                    NEW.second_user_name := temp;
                END;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        DROP TRIGGER IF EXISTS enforce_chat_order_trigger ON chats
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TRIGGER enforce_chat_order_trigger
        BEFORE INSERT OR UPDATE ON chats
        FOR EACH ROW EXECUTE FUNCTION enforce_chat_order()
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[get("/ws")]
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<Arc<AppState>>,
) -> Result<HttpResponse, Error> {
    let token = match req.cookie("token") {
        Some(token) => token.value().to_string(),
        None => return Ok(HttpResponse::Unauthorized().finish()),
    };

    let claims = match verify_token(token) {
        Ok(claims) => claims,
        Err(_) => return Ok(HttpResponse::Unauthorized().finish()),
    };

    let email = claims.sub.clone();
    let username = claims.email.clone();

    let user_chats = match sqlx::query_scalar::<_, i32>(
        "SELECT id FROM chats WHERE first_user_name = $1 OR second_user_name = $1",
    )
    .bind(&username)
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(chats) => chats,
        Err(e) => {
            eprintln!("Error fetching user chats: {}", e);
            vec![]
        }
    };

    let (response, session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let db_pool = state.db_pool.clone();
    let second_db_pool = state.db_pool.clone();
    let tx = state.tx.clone();
    let mut rx = tx.subscribe();
    let user_sessions = state.user_sessions.clone();
    let broadcast_user_sessions = user_sessions.clone();

    {
        let mut sessions = user_sessions.write().await;
        sessions.insert(
            email.clone(),
            UserSession {
                email: email.clone(),
                username: username.clone(),
                user_chats: user_chats.clone(),
                tx: tx.clone(),
            },
        );
    }

    let mut broadcast_session = session.clone();
    let mut _message_session = session;

    let broadcast_email = email.clone();

    actix_rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(ws_msg) = serde_json::from_str::<WebSocketMessage>(&text) {
                        match ws_msg.action.as_str() {
                            "new_message" => {
                                if let Ok(new_msg) =
                                    serde_json::from_value::<NewMessage>(ws_msg.payload)
                                {
                                    if let Some(chat_partner) = new_msg.chat_partner {
                                        let chat_id = match sqlx::query_scalar::<_, i32>(
                                            "SELECT id FROM chats WHERE (first_user_name = $1 AND second_user_name = $2) OR (first_user_name = $2 AND second_user_name = $1)"
                                        )
                                        .bind(&username)
                                        .bind(&chat_partner)
                                        .fetch_optional(&db_pool)
                                        .await
                                        {
                                            Ok(Some(id)) => id,
                                            Ok(None) => {
                                                match sqlx::query_scalar(
                                                    "INSERT INTO chats (first_user_name, second_user_name) VALUES ($1, $2) RETURNING id"
                                                )
                                                .bind(&username)
                                                .bind(&chat_partner)
                                                .fetch_one(&db_pool)
                                                .await {
                                                        Ok(id) => id,
                                                        Err(e) => {
                                                            eprintln!("Error creating chat: {}", e);
                                                            return;
                                                        }
                                                    }
                                            },
                                            Err(e) => {
                                                eprintln!("Error checking/creating chat: {}", e);
                                                return;
                                            }
                                        };

                                        if new_msg.reply.is_some() {
                                            let replied_message_chat_id =
                                                match sqlx::query_scalar::<_, i32>(
                                                    "SELECT chat_id FROM messages WHERE id = $1",
                                                )
                                                .bind(&new_msg.reply)
                                                .fetch_one(&db_pool)
                                                .await
                                                {
                                                    Ok(replied_message_chat_id) => {
                                                        replied_message_chat_id
                                                    }
                                                    Err(e) => {
                                                        eprintln!(
                                                            "Error selecting replied message chat id: {}",
                                                            e
                                                        );
                                                        continue; // hmmmmmmmmmmmmmmmm
                                                    }
                                                };

                                            if replied_message_chat_id == chat_id {
                                                let replied_message = match sqlx::query_scalar::<
                                                    _,
                                                    String,
                                                >(
                                                    "SELECT message FROM messages WHERE id = $1",
                                                )
                                                .bind(&new_msg.reply)
                                                .fetch_one(&db_pool)
                                                .await
                                                {
                                                    Ok(replied_message) => replied_message,
                                                    Err(e) => {
                                                        eprintln!(
                                                            "Error selecting replied message: {}",
                                                            e
                                                        );
                                                        return;
                                                    }
                                                };

                                                let replied_user = match sqlx::query_scalar::<
                                                    _,
                                                    String,
                                                >(
                                                    "SELECT username FROM messages WHERE id = $1",
                                                )
                                                .bind(&new_msg.reply)
                                                .fetch_one(&db_pool)
                                                .await
                                                {
                                                    Ok(replied_user) => replied_user,
                                                    Err(e) => {
                                                        eprintln!(
                                                            "Error selecting replied user: {}",
                                                            e
                                                        );
                                                        return;
                                                    }
                                                };

                                                println!("Replied user: {:?}", replied_user);

                                                println!("Replied message: {:?}", replied_message);

                                                match sqlx::query_as::<_, ChatMessage>(
                                                    "INSERT INTO messages (chat_id, email, username, message, replied_user, replied_message, time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *"
                                                )
                                                .bind(&chat_id)
                                                .bind(&email)
                                                .bind(&username)
                                                .bind(&new_msg.message)
                                                .bind(&replied_user)
                                                .bind(&replied_message)
                                                .bind(Utc::now())
                                                .fetch_one(&db_pool)
                                                .await
                                                {
                                                    Ok(message) => {
                                                        match sqlx::query(
                                                            r#"
                                                                UPDATE chats
                                                                SET last_update = $1
                                                                WHERE id = $2
                                                            "#,
                                                        )
                                                        .bind(Utc::now())
                                                        .bind(&chat_id)
                                                        .execute(&db_pool)
                                                        .await
                                                        {
                                                            Ok(_) => println!("Chat updated successfully"),
                                                            Err(e) => {
                                                                eprintln!("Error updating chat last update: {}", e);
                                                            }
                                                        }
                                                        let _ = tx.send(OutgoingMessage::NewMessage(message));
                                                    }
                                                    Err(e) => {
                                                        println!("error sending message: {}", e);
                                                    }
                                                }
                                            } else {
                                                eprintln!(
                                                    "you cannot reply message from other chat"
                                                )
                                            }
                                        } else {
                                            match sqlx::query_as::<_, ChatMessage>(
                                                "INSERT INTO messages (chat_id, email, username, message, time) VALUES ($1, $2, $3, $4, $5) RETURNING *"
                                            )
                                            .bind(&chat_id)
                                            .bind(&email)
                                            .bind(&username)
                                            .bind(&new_msg.message)
                                            .bind(Utc::now())
                                            .fetch_one(&db_pool)
                                            .await
                                            {
                                                Ok(message) => {
                                                    match sqlx::query(
                                                        r#"
                                                            UPDATE chats
                                                            SET last_update = $1
                                                            WHERE id = $2
                                                        "#,
                                                    )
                                                    .bind(Utc::now())
                                                    .bind(&chat_id)
                                                    .execute(&db_pool)
                                                    .await
                                                    {
                                                        Ok(_) => println!("Chat updated successfully"),
                                                        Err(e) => {
                                                            eprintln!("Error updating chat last update: {}", e);
                                                        }
                                                    }
                                                    let _ = tx.send(OutgoingMessage::NewMessage(message));
                                                }
                                                Err(e) => {
                                                    println!("error sending message: {}", e)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "new_chat" => {
                                if let Ok(new_chat) =
                                    serde_json::from_value::<NewChat>(ws_msg.payload)
                                {
                                    if let Some(second_user_name) = new_chat.second_user_name {
                                        let can_create_chat = match sqlx::query_scalar::<_, bool>(
                                            "SELECT EXISTS(SELECT * FROM friends WHERE (sender_username = $1 AND receiver_username = $2) OR (sender_username = $2 AND receiver_username = $1))"
                                        )
                                        .bind(&username)
                                        .bind(&second_user_name)
                                        .fetch_optional(&db_pool)
                                        .await {
                                            Ok(can_create_chat) => can_create_chat,
                                            Err(_) => {
                                                println!("{} can't send message to this user", &username);
                                                Some(false)
                                            }
                                        };

                                        if can_create_chat == Some(false) {
                                            println!("{} can't create chat", &username);
                                            return;
                                        }

                                        let existing_chat = sqlx::query_scalar::<_, i32>(
                                            "SELECT id FROM chats WHERE
                                            (first_user_name = LEAST($1, $2) AND second_user_name = GREATEST($1, $2))"
                                        )
                                        .bind(&username)
                                        .bind(&second_user_name)
                                        .fetch_optional(&db_pool)
                                        .await;

                                        if let Ok(Some(_id)) = existing_chat {
                                            println!("chat already exists");
                                            return;
                                        }

                                        match sqlx::query_as::<_, Chat> (
                                            "INSERT INTO chats (first_user_name, second_user_name) VALUES ($1, $2) RETURNING *"
                                        )
                                        .bind(&username)
                                        .bind(&second_user_name)
                                        .fetch_one(&db_pool)
                                        .await
                                        {
                                            Ok(chat) => {
                                                if let Err(e) = state.update_user_chats(&username).await {
                                                    eprintln!("Failed to update user chats: {}", e);
                                                }
                                                if let Err(e) = state.update_user_chats(&second_user_name).await {
                                                    eprintln!("Failed to update partner chats: {}", e);
                                                }
                                                let _ = tx.send(OutgoingMessage::NewChat(chat));
                                            },
                                            Err(_) => println!("error creating chat")
                                        }
                                    }
                                }
                            }
                            "delete_message" => {
                                if let Ok(delete_req) =
                                    serde_json::from_value::<DeleteMessageRequest>(ws_msg.payload)
                                {
                                    match sqlx::query_as::<_, ChatMessage>(
                                        "SELECT id, chat_id, email, username, message, replied_user, replied_message, time FROM messages WHERE id = $1"
                                    )
                                    .bind(delete_req.id)
                                    .fetch_optional(&db_pool)
                                    .await {
                                        Ok(Some(msg)) => {
                                            if msg.email != email {
                                                let _error_response = serde_json::json!({
                                                    "status": "error",
                                                    "message": "You can only delete your own messages"
                                                });
                                                continue;
                                            }

                                            match sqlx::query("DELETE FROM messages WHERE id = $1")
                                                .bind(delete_req.id)
                                                .execute(&db_pool)
                                                .await {
                                                Ok(_) => {
                                                    let _ = tx.send(OutgoingMessage::Delete { message_id: delete_req.id });
                                                }
                                                Err(e) => {
                                                    eprintln!("Error deleting message: {:?}", e);
                                                }
                                            }
                                        },
                                        Ok(None) => {
                                            let _error_response = serde_json::json!({
                                                "status": "error",
                                                "message": "Message not found"
                                            });
                                        },
                                        Err(e) => {
                                            eprintln!("Error fetching message: {}", e);
                                        }
                                    }
                                }
                            }
                            _ => eprintln!("Unknown action: {}", ws_msg.action),
                        }
                    }
                }
                Message::Close(_) => {
                    println!("(chat.rs) Session closed");
                    {
                        let mut sessions_write = user_sessions.write().await;
                        sessions_write.remove(&email);
                    }
                    println!("session removed.");
                    break;
                }
                _ => {}
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

                            let current_user_chats = {
                                let sessions = broadcast_user_sessions.read().await;
                                if let Some(user_session) = sessions.get(&broadcast_email) {
                                    user_session.user_chats.clone()
                                } else {
                                    continue;
                                }
                            };

                            let should_send = match &msg {
                                OutgoingMessage::NewMessage(chat_msg) => {
                                    if let Some(chat_id) = chat_msg.chat_id {
                                        if current_user_chats.contains(&chat_id) {
                                            true
                                        } else {
                                            match sqlx::query_scalar::<_, bool>(
                                                "SELECT EXISTS(SELECT * FROM chats WHERE id = $1 AND (first_user_name = $2 OR second_user_name = $2))"
                                            )
                                            .bind(chat_id)
                                            .bind(&broadcast_email)
                                            .fetch_one(&second_db_pool)
                                            .await {
                                                Ok(exists) => exists,
                                                Err(_) => false
                                            }
                                        }
                                    } else {
                                        false
                                    }
                                }
                                OutgoingMessage::Delete { message_id: _ } => true,
                                OutgoingMessage::NewChat(chat) => {
                                    chat.first_user_name == broadcast_email
                                        || chat.second_user_name == broadcast_email
                                }
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

impl AppState {
    pub fn new(db_pool: PgPool) -> Self {
        let (tx, _) = broadcast::channel(1000);
        Self {
            db_pool,
            tx,
            user_sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn update_user_chats(&self, username: &str) -> Result<(), sqlx::Error> {
        let updated_chats = sqlx::query_scalar::<_, i32>(
            "SELECT id FROM chats WHERE first_user_name = $1 OR second_user_name = $1",
        )
        .bind(username)
        .fetch_all(&self.db_pool)
        .await?;

        let mut sessions = self.user_sessions.write().await;
        for (_, session) in sessions.iter_mut() {
            if session.username == username {
                session.user_chats = updated_chats.clone();
                break;
            }
        }

        Ok(())
    }
}

#[get("/chats")]
pub async fn get_chats(
    state: web::Data<Arc<AppState>>,
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

    match sqlx::query_as::<_, Chat>(
        "SELECT id, first_user_name, second_user_name, last_update FROM chats WHERE first_user_name = $1 OR second_user_name = $1",
    )
    .bind(&username)
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(chats) => return Ok(HttpResponse::Ok().json(chats)),
        Err(e) => {
            eprintln!("Error fetching chats: {}", e);
            return Ok(HttpResponse::InternalServerError().json("Error fetching chats"));
        }
    }
}

#[get("/messages/{chat_id}")]
pub async fn get_chat_messages(
    state: web::Data<Arc<AppState>>,
    req: HttpRequest,
    path: web::Path<i32>,
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
    let chat_id = path.into_inner();

    let is_member = match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND (first_user_name = $2 OR second_user_name = $2))",
    )
    .bind(chat_id)
    .bind(&username)
    .fetch_one(&state.db_pool)
    .await
    {
        Ok(exists) => exists,
        Err(e) => {
            eprintln!("Error checking chat membership: {}", e);
            return Ok(HttpResponse::InternalServerError().json("Error checking chat membership"));
        }
    };

    if !is_member {
        return Ok(HttpResponse::Forbidden().json("You are not a member of this chat"));
    }

    match sqlx::query_as::<_, ChatMessage>(
        "SELECT id, chat_id, email, username, message, replied_user, replied_message, time FROM messages WHERE chat_id = $1 ORDER BY time ASC",
    )
    .bind(chat_id)
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(messages) => return Ok(HttpResponse::Ok().json(messages)),
        Err(e) => {
            eprintln!("Error fetching chat messages: {}", e);
            return Ok(HttpResponse::InternalServerError().json("Error fetching chat messages"));
        }
    }
}
