# syntax=docker/dockerfile:1
FROM rust:1.99.1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
ARG BUILD_HASH=local
ENV BUILD_HASH=$BUILD_HASH
ENV CARGO_HOME=/cargo-cache/cargo CARGO_TARGET_DIR=/cargo-cache/target
RUN --mount=type=cache,target=/cargo-cache \
    cargo build --locked --release && \
    cp /cargo-cache/target/release/tapes /usr/local/bin/tapes

FROM debian:bookworm-slim AS runtime
RUN mkdir -p /app/data && chown -R 10001:10001 /app
COPY --from=build /usr/local/bin/tapes /usr/local/bin/tapes
USER 10001:10001
ENV TAPES_LISTEN=0.0.0.0:4300 TAPES_DATABASE=/app/data/progress.sqlite TAPES_LIBRARY=/library
EXPOSE 4300
ENTRYPOINT ["tapes"]
CMD ["serve"]
