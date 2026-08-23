# Build from the repository root, since this is one crate in a Cargo
# workspace and the whole workspace manifest has to be visible to resolve:
#
#   docker build -f crates/sync-server/Dockerfile -t nodus-sync-server .
#   docker run -p 8420:8420 -v nodus-data:/data nodus-sync-server
#
# Everything the server needs is already inside the image — SQLite is
# compiled in (the `bundled` feature), not a separate package to install —
# so that one `docker run` is the entire setup.

FROM rust:1-bookworm AS build
WORKDIR /build
COPY . .
RUN cargo build --release -p nodus-sync-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/nodus-sync-server /usr/local/bin/nodus-sync-server
VOLUME ["/data"]
EXPOSE 8420
ENTRYPOINT ["nodus-sync-server", "--data-dir", "/data", "--port", "8420"]
