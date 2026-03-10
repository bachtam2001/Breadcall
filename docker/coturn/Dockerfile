FROM coturn/coturn:latest

# Copy configuration
COPY turnserver.conf /etc/turnserver.conf


# Expose TURN/STUN ports
EXPOSE 3478/tcp
EXPOSE 3478/udp
EXPOSE 5349/tcp
EXPOSE 5349/udp
EXPOSE 49152-65535/udp

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD nc -z -u localhost 3478 || exit 1

# Run coturn
ENTRYPOINT ["turnserver"]
CMD ["-c", "/etc/turnserver.conf"]
