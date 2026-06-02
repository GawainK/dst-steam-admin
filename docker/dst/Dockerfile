FROM debian:bookworm-slim

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    lib32gcc-s1 \
    libcurl4:i386 \
    libgcc-s1:i386 \
    libstdc++6:i386 \
    libcurl4 \
    libstdc++6 \
    tar \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dst

COPY docker/dst/entrypoint.sh /usr/local/bin/dst-entrypoint
COPY docker/dst/install-server.sh /usr/local/bin/dst-install-server
COPY docker/dst/render-config.sh /usr/local/bin/dst-render-config
COPY docker/dst/cluster.ini.template /opt/dst/templates/cluster.ini.template
COPY docker/dst/server.ini.template /opt/dst/templates/server.ini.template

RUN chmod +x /usr/local/bin/dst-entrypoint /usr/local/bin/dst-install-server /usr/local/bin/dst-render-config

VOLUME ["/var/lib/dst/cluster", "/var/lib/dst/mods"]

ENTRYPOINT ["/usr/local/bin/dst-entrypoint"]
