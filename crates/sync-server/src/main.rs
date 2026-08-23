use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use clap::Parser;
use rand::RngCore;

use nodus_sync_server::{build_router, db, gc, state::AppState};

/// One-command startup: `nodus-sync-server --port 8420 --data-dir ./data`.
/// Everything else (auth, chunking, quotas) is client-driven or automatic.
#[derive(Parser)]
#[command(name = "nodus-sync-server", about = "Self-hosted sync server for Nodus")]
struct Args {
    #[arg(long, default_value_t = 8420)]
    port: u16,
    #[arg(long, default_value = "0.0.0.0")]
    bind: String,
    #[arg(long, default_value = "./data")]
    data_dir: PathBuf,
    /// Maximum total stored (encrypted) bytes across all chunks. Unset means unlimited.
    #[arg(long)]
    max_storage_mb: Option<u64>,
    /// Largest single chunk this server will accept. Unset means unlimited.
    #[arg(long)]
    max_file_size_mb: Option<u64>,
    /// Set this to also serve as a Telegram Mini App backend in "server
    /// mode" — required to verify that a Mini App session's `initData`
    /// really came from Telegram signed with this bot.
    #[arg(long)]
    telegram_bot_token: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    std::fs::create_dir_all(&args.data_dir).expect("failed to create data directory");
    let db_path = args.data_dir.join("db.sqlite");
    let conn = db::open(&db_path).expect("failed to open database");

    if db::device_count(&conn).expect("failed to query devices") == 0 {
        let code = generate_bootstrap_code();
        db::set_bootstrap_code(&conn, &code).expect("failed to store bootstrap code");
        print_bootstrap_banner(&code);
    }

    let state = AppState {
        conn: Arc::new(Mutex::new(conn)),
        data_dir: args.data_dir.clone(),
        max_storage_bytes: args.max_storage_mb.map(|mb| mb * 1024 * 1024),
        max_file_size_bytes: args.max_file_size_mb.map(|mb| mb * 1024 * 1024),
        telegram_bot_token: args.telegram_bot_token.clone(),
    };

    spawn_gc_loop(state.clone());

    let router = build_router(state);
    let addr = format!("{}:{}", args.bind, args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("failed to bind");
    tracing::info!("nodus-sync-server listening on {addr}");
    axum::serve(listener, router).await.expect("server error");
}

fn generate_bootstrap_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut raw = [0u8; 8];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    raw.iter().map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect()
}

fn print_bootstrap_banner(code: &str) {
    eprintln!();
    eprintln!("==================================================");
    eprintln!(" No devices are paired with this server yet.");
    eprintln!(" Enter this code in Nodus to connect the first device:");
    eprintln!();
    eprintln!("     {code}");
    eprintln!();
    eprintln!(" Regenerated every restart while unpaired, and cleared");
    eprintln!(" as soon as a device claims it.");
    eprintln!("==================================================");
    eprintln!();
}

fn spawn_gc_loop(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(600));
        loop {
            interval.tick().await;
            let conn = state.conn.lock().expect("db mutex poisoned");
            match gc::run_gc_once(&conn, &state.data_dir) {
                Ok(n) if n > 0 => tracing::info!("garbage-collected {n} orphaned chunk(s)"),
                Ok(_) => {}
                Err(e) => tracing::warn!("gc pass failed: {e}"),
            }
        }
    });
}
