# Runtime dependencies and scripts only. SteamCMD installs the game into the
# server's /opt/dst bind mount when the container starts, never during a build.
FROM debian:bookworm-slim AS runtime

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
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="DST Steam Admin runtime" \
      org.opencontainers.image.revision="${VCS_REF}"
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
