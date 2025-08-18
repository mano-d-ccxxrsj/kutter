use actix_files as fs;
use actix_web::{App, HttpServer, web};
use dotenv::dotenv;
use regex::Regex;
use std::sync::Arc;
pub mod db;
pub mod middlewares;
pub mod routes;

#[derive(Clone)]
pub struct RegexValidator {
    pub email: Regex,
    pub username: Regex,
    pub password: Regex,
}

impl RegexValidator {
    pub fn new() -> Self {
        Self {
            email: Regex::new(r"^[\w\.-]+@[\w\.-]+\.\w{2,}$").unwrap(),
            username: Regex::new(r"^[a-z0-9_-]{2,20}$").unwrap(),
            password: Regex::new(r"^.{6,}$").unwrap(),
        }
    }

    pub fn validate_password(&self, password: &str) -> bool {
        if !self.password.is_match(password) {
            return false;
        }

        true
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    let pool = db::create_pool().await;

    let regex_validator = RegexValidator::new();

    let chat_state = Arc::new(routes::chat::AppState::new(pool.clone()));

    let friend_state = Arc::new(routes::friend::FriendAppState::new(pool.clone()));

    middlewares::create_user_table(&pool)
        .await
        .expect("Failed to create table");

    routes::chat::chats(&pool)
        .await
        .expect("Failed to create table");

    routes::chat::create_table(&pool)
        .await
        .expect("Failed to create table");

    routes::friend::friend_table(&pool)
        .await
        .expect("Failed to create table");

    HttpServer::new(move || {
        let app = App::new()
            .app_data(web::Data::new(pool.clone()))
            .app_data(web::Data::new(chat_state.clone()))
            .app_data(web::Data::new(friend_state.clone()))
            .app_data(web::Data::new(regex_validator.clone()))
            .wrap(middlewares::cors());
        app.service(routes::auth::register)
            .service(routes::auth::login)
            .service(routes::auth::verify_user)
            .service(routes::chat::ws_handler)
            .service(routes::chat::get_chats)
            .service(routes::chat::get_chat_messages)
            .service(routes::friend::ws_handler)
            .service(routes::friend::get_friend_req)
            .service(routes::auth::upload_avatar)
            .service(routes::auth::verify_email)
            .service(routes::auth::logout)
            .service(fs::Files::new("/uploads", "./uploads"))
            .service(fs::Files::new("/", "./static").index_file("index.html"))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
