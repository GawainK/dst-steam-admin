FROM debian:bookworm-slim AS base

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    tini \
    python3 \
    ca-certificates \
    curl \
    lib32gcc-s1 \
    libcurl4:i386 \
    libgcc-s1:i386 \
    libstdc++6:i386 \
    libcurl4 \
    libcurl3-gnutls \
    libstdc++6 \
    tar \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dst
COPY docker/dst/entrypoint.sh /usr/local/bin/dst-entrypoint
COPY docker/dst/supervisor.py /usr/local/bin/dst-supervisor.py
COPY docker/dst/install-server.sh /usr/local/bin/dst-install-server
COPY docker/dst/render-config.sh /usr/local/bin/dst-render-config
COPY docker/dst/cluster.ini.template /opt/dst-templates/cluster.ini.template
COPY docker/dst/server.ini.template /opt/dst-templates/server.ini.template
RUN chmod +x /usr/local/bin/dst-entrypoint /usr/local/bin/dst-install-server /usr/local/bin/dst-render-config

HEALTHCHECK --interval=10s --timeout=3s --start-period=15m --retries=3 \
  CMD ["python3", "/usr/local/bin/dst-supervisor.py", "--healthcheck"]
VOLUME ["/var/lib/dst/cluster", "/var/lib/dst/mods"]
# Signal only the supervisor; it saves then stops each owned process group.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dst-entrypoint"]

# Explicit target for CI: resolve/build once, then verify against the requested ID.
FROM base AS downloader
ARG DST_BUILD_ID
RUN test -n "$DST_BUILD_ID" \
  && DST_EXPECTED_BUILD_ID="$DST_BUILD_ID" /usr/local/bin/dst-install-server

FROM base AS preinstalled
ARG DST_BUILD_ID
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="DST Steam Admin game server" \
      org.opencontainers.image.version="build-${DST_BUILD_ID}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.dst.build-id="${DST_BUILD_ID}"
# Keep image files outside /opt/dst so the existing install bind mount cannot hide them.
COPY --from=downloader /opt/dst /opt/dst-image
ENV DST_UPDATE_MODE=image

# Default local build retains the existing download/update-at-start behavior.
FROM base AS runtime
ENV DST_UPDATE_MODE=startup
