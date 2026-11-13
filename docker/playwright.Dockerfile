# Isolated environment for the Playwright browser tests.
# The image tag MUST match the exact @playwright/test version in package.json,
# because each Playwright release expects specific browser builds.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

ENV PLAYWRIGHT_IN_DOCKER=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Run as the image's unprivileged user rather than root.
USER pwuser
WORKDIR /home/pwuser/app

# Install dependencies first (Linux builds, separate from the host's node_modules)
# so this layer is cached until package*.json changes.
COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN npm ci

COPY --chown=pwuser:pwuser . .

ENTRYPOINT ["./node_modules/.bin/playwright", "test"]
