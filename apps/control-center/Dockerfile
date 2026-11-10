# syntax=docker/dockerfile:1
FROM rust:1.99.1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY server ./server
ARG BUILD_HASH=local
ENV BUILD_HASH=$BUILD_HASH
ENV CARGO_HOME=/cargo-cache/cargo CARGO_TARGET_DIR=/cargo-cache/target
RUN --mount=type=cache,target=/cargo-cache \
    cargo build --locked --release -p www-server && \
    cp /cargo-cache/target/release/www-server /usr/local/bin/www-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data /app/media && chown -R 10001:10001 /app
COPY --from=build /usr/local/bin/www-server /usr/local/bin/www-server
USER 10001:10001
ENV WWW_LISTEN=0.0.0.0:4201 WWW_DATA_DIR=/app/data MEDIA_STORAGE_DIR=/app/media
EXPOSE 4201
ENTRYPOINT ["www-server"]
