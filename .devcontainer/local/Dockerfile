FROM mcr.microsoft.com/devcontainers/dotnet:1-10.0

# Remove the stale Yarn apt source whose GPG key has expired (NO_PUBKEY 62D54FD4003F6525).
# This prevents apt-get update failures in downstream feature installs.
RUN rm -f /etc/apt/sources.list.d/yarn.list
