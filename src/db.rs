use sqlx::postgres::PgPoolOptions;
use std::env;

pub async fn create_pool() -> sqlx::Pool<sqlx::Postgres> {
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    PgPoolOptions::new()
        .max_connections(200)
        .min_connections(40)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(30 * 60))
        .max_lifetime(std::time::Duration::from_secs(60 * 60))
        .connect(&database_url)
        .await
        .expect("Failed to create database connection pool")
}
