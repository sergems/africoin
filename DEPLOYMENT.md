# Production Deployment Guide

This guide deploys the existing Africoin full-stack application to a Linode Ubuntu server using Docker Compose and Nginx. It does not rebuild the product or change its business behavior. The public network reaches Nginx on ports 80 and 443. Nginx forwards requests to the application container on a localhost-only port. The MySQL database is reachable only inside the Docker Compose network.

## A. What has been configured

The project now contains a multi-stage `Dockerfile`, a private MySQL Compose stack in `deploy/docker-compose.yml`, Nginx configurations in `deploy/nginx/`, a safe environment template at `deploy/env.example`, and operational scripts for deployment, backup, and guarded restore. The root `deploy.sh` delegates to `deploy/scripts/deploy.sh`.

The Node server now binds to `HOST` and `PORT`, defaults to `0.0.0.0:3000` in production, trusts one reverse-proxy hop, disables the Express `X-Powered-By` header, and exposes `GET /api/health`. Development mode still searches for a free port so the WebDev preview is not disrupted.

The application is a single Node process. It serves the built React/Vite frontend, tRPC under `/api/trpc`, the health endpoint at `/api/health`, the storage proxy under `/manus-storage/*`, and the WebSocket market stream at `/api/market-stream`.

## B. Exact production architecture

```text
Internet
  |
  v
DNS A record -> Linode 45.79.210.216
  |
  v
Nginx :80/:443
  |
  v
Docker Compose app -> 127.0.0.1:3000 only
  |
  +--> MySQL 8.4 on the private Compose network
  |
  +--> Optional external Manus Forge services for storage, notifications, maps, or images
```

The production database engine is **MySQL 8.4**. The application port inside the container is **3000**. The host publishes it only on `127.0.0.1:${APP_PORT}` so it is not directly reachable from the Internet. Nginx is the only public application entry point.

## C. Application commands and runtime behavior

Install dependencies with the repository’s pinned package manager:

```bash
corepack enable
corepack prepare pnpm@10.4.1 --activate
pnpm install --frozen-lockfile
```

The project also exposes the requested npm script names after dependencies are installed:

```bash
npm run dev
npm run build
npm run start
```

The recommended production commands are:

```bash
pnpm run build
NODE_ENV=production HOST=0.0.0.0 PORT=3000 pnpm run start
```

The normal production migration command is:

```bash
pnpm run db:migrate
```

This runs `drizzle-kit migrate` against the existing migration files. Do not use `pnpm run db:push` or `drizzle-kit push` for production changes. Generate migration files during development, review them, commit them, and apply them with `db:migrate`.

## D. Required and optional environment variables

Copy the template before editing it:

```bash
cp deploy/env.example .env
chmod 600 .env
```

Required values are:

| Variable              | Purpose                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | MySQL connection string used by Drizzle and the server. In Compose, use the service hostname `db`. URL-encode special characters in the password. |
| `MYSQL_DATABASE`      | Database name created by the MySQL container.                                                                                                     |
| `MYSQL_USER`          | Application database user.                                                                                                                        |
| `MYSQL_PASSWORD`      | Application database password.                                                                                                                    |
| `MYSQL_ROOT_PASSWORD` | MySQL root password used for administration and health checks.                                                                                    |
| `JWT_SECRET`          | Secret used to sign local Africoin authentication cookies. Use at least 32 random characters.                                                     |
| `NODE_ENV`            | Set to `production`.                                                                                                                              |
| `HOST`                | Set to `0.0.0.0` inside the app container.                                                                                                        |
| `APP_PORT`            | Host-only published port, normally `3000`.                                                                                                        |

Optional values are `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY` for the storage proxy, owner notifications, maps, and image services. The Vite build-time values `VITE_FRONTEND_FORGE_API_URL`, `VITE_FRONTEND_FORGE_API_KEY`, `VITE_ANALYTICS_ENDPOINT`, and `VITE_ANALYTICS_WEBSITE_ID` are also optional. Only put a browser-safe key in a `VITE_*` variable because Vite embeds these values in the browser bundle.

`ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_ROLE` are optional one-time bootstrap values. The bootstrap script requires a password of at least 12 characters. `ADMIN_ROLE` defaults to `admin`; set it to `super_admin` when creating the platform owner account. Remove these temporary values from `.env` after running the bootstrap command.

## E. Fresh Ubuntu server preparation

SSH into the Linode server. Replace `root` with your normal sudo-enabled user if one already exists.

```bash
ssh root@45.79.210.216
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw
```

Install Docker Engine and the Compose plugin using Docker’s Ubuntu repository:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu" \
  "$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

docker --version
docker compose version
```

If you deploy as a non-root user, add that user to Docker and start a new SSH session:

```bash
usermod -aG docker YOUR_USERNAME
exit
```

Configure the firewall. SSH is allowed before enabling the firewall so you do not lock yourself out:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
```

Do not open port 3000 or port 3306. The application is bound to loopback and the database has no host port mapping.

## F. Domain and DNS setup

The production domain is `africoin.gowinrdc.com`. Create this A record at your DNS provider:

```text
Type: A
Name: africoin
Value: 45.79.210.216
TTL: 300 or provider default
```

Wait for DNS propagation and verify it from the server or your workstation:

```bash
getent hosts africoin.gowinrdc.com
```

The repository Nginx files are already configured for `africoin.gowinrdc.com`.

## G. Clone the repository and configure the environment

Choose an application directory and clone the repository:

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/sergems/africoin.git africoin
cd /opt/africoin
cp deploy/env.example .env
chmod 600 .env
nano .env
```

Set strong, unique values. For a Compose deployment, `DATABASE_URL` should use the internal hostname:

```dotenv
DATABASE_URL=mysql://africoin:URL_ENCODED_PASSWORD@db:3306/africoin
```

If the password contains `@`, `:`, `/`, `?`, or `#`, URL-encode it or choose a password that is safe in a URL. Keep `MYSQL_PASSWORD` equal to the decoded database password.

Check the Compose configuration without starting containers:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml config -q
```

## H. MySQL installation and initialization

This deployment installs MySQL **inside Docker**; do not install a second MySQL server with `apt install mysql-server`. The `db` service in `deploy/docker-compose.yml` pulls the official `mysql:8.4` image, creates the `africoin_mysql_data` named volume, and initializes the database and application user from `.env` on its first successful startup.

From `/opt/africoin`, first verify that the required database variables are present and that Compose renders the expected service configuration:

```bash
grep -E '^(MYSQL_DATABASE|MYSQL_USER|MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|DATABASE_URL)=' .env
docker compose --env-file .env -f deploy/docker-compose.yml config
```

Pull the MySQL image explicitly, then start only the database:

```bash
docker pull mysql:8.4
docker compose --env-file .env -f deploy/docker-compose.yml up -d db
```

Wait for the health check to become `healthy`. This can take 30–90 seconds on the first run while MySQL initializes its data directory:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml ps db
docker inspect --format '{{.State.Health.Status}}' $(docker compose --env-file .env -f deploy/docker-compose.yml ps -q db)
```

If the status is not `healthy`, inspect the initialization log:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 db
```

Once healthy, verify the database from inside the MySQL container. This does not expose port 3306 publicly:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec db \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "SHOW DATABASES;"'
```

The expected database is the value of `MYSQL_DATABASE`, normally `africoin`. The application connects to the Compose service hostname `db`, not `localhost`; therefore `.env` must contain a URL like this:

```dotenv
DATABASE_URL=mysql://africoin:URL_ENCODED_PASSWORD@db:3306/africoin
```

If MySQL was previously initialized with incorrect credentials, changing `.env` alone does not change the existing users because MySQL only applies `MYSQL_*` initialization variables to an empty data directory. Preserve the data first, then deliberately reinitialize only if this is a new installation:

```bash
./deploy/scripts/backup.sh
docker compose --env-file .env -f deploy/docker-compose.yml down
docker compose --env-file .env -f deploy/docker-compose.yml config --volumes
# Destructive for the database volume; run only on a fresh installation:
docker compose --env-file .env -f deploy/docker-compose.yml down -v
docker compose --env-file .env -f deploy/docker-compose.yml up -d db
```

## I. First Docker deployment

Build the application and migration image:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml build app migrate
```

Start MySQL and wait for its health check:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d db
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

Apply the checked-in Drizzle migrations. This is non-destructive and does not recreate the database:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml --profile tools run --rm migrate
```

Start the application:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d app
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/health
```

Expected health response:

```json
{ "status": "ok" }
```

The same workflow is wrapped by the safe update script:

```bash
./deploy.sh
```

The script performs a fast-forward-only `git pull`, validates Compose, builds the images, starts MySQL, runs migrations, starts the app, and waits for `/api/health`. It never deletes containers or volumes. If the repository has local changes or the pull cannot be fast-forwarded, it stops.

To deploy code already present on disk without pulling:

```bash
SKIP_GIT_PULL=1 ./deploy.sh
```

## J. Optional admin bootstrap

After the first migration, use a temporary shell environment for the admin credentials:

```bash
export ADMIN_EMAIL='admin@example.com'
export ADMIN_PASSWORD='replace-with-at-least-12-characters'
export ADMIN_ROLE='super_admin'
docker compose --env-file .env -f deploy/docker-compose.yml run --rm \
  -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_ROLE migrate \
  pnpm run admin:bootstrap
unset ADMIN_EMAIL ADMIN_PASSWORD ADMIN_ROLE
```

The bootstrap command creates or updates the local email/password account with the requested role and its initial USD/CDF wallets and KYC record. Use the resulting email and password at the Africoin login screen. Remove any admin credentials from `.env` after use. The password is never printed by the script.

## K. Nginx installation before SSL

Install Nginx and Certbot:

```bash
apt install -y nginx certbot python3-certbot-nginx
mkdir -p /var/www/certbot
```

Install the temporary HTTP configuration:

```bash
cp /opt/africoin/deploy/nginx/app.bootstrap.conf /etc/nginx/sites-available/africoin
ln -sfn /etc/nginx/sites-available/africoin /etc/nginx/sites-enabled/africoin
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

At this point, HTTP should proxy to the application and the ACME challenge path should be available.

## K. Let's Encrypt SSL certificate

Request the certificate after DNS resolves to `45.79.210.216`:

```bash
certbot certonly --webroot -w /var/www/certbot \
  -d africoin.gowinrdc.com \
  --email YOUR_EMAIL \
  --agree-tos \
  --no-eff-email
```

Install the final HTTPS configuration. Replace both the domain and certificate paths if you use a non-default domain:

```bash
cp /opt/africoin/deploy/nginx/app.conf /etc/nginx/sites-available/africoin
nginx -t
systemctl reload nginx
```

Test the HTTPS endpoint:

```bash
curl --fail https://africoin.gowinrdc.com/api/health
```

Certbot normally installs a renewal timer. Verify and test it:

```bash
systemctl status certbot.timer
certbot renew --dry-run
```

## L. Updating the application

The normal update command is:

```bash
cd /opt/africoin
./deploy.sh
```

It pulls only fast-forward changes, rebuilds the image, starts the database, applies migrations, restarts the application, and checks the health endpoint. It does not run destructive schema operations.

If a migration fails, the script stops before declaring the deployment healthy. Inspect the migration error and database state before retrying:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 db
docker compose --env-file .env -f deploy/docker-compose.yml --profile tools run --rm migrate
```

## M. Logs and service operations

Show service state:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

Follow application logs:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs -f --tail=200 app
```

Follow database logs:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs -f --tail=200 db
```

Restart only the application:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml restart app
```

Restart the complete stack without deleting volumes:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

Do not use `docker compose down -v` in production. The `-v` option deletes the MySQL data volume.

## N. Database backups

Create a compressed MySQL dump outside the application container:

```bash
cd /opt/africoin
./deploy/scripts/backup.sh
```

Backups are written to `backups/` with mode `600`. Copy them off the Linode server as soon as practical. For example, from a trusted workstation:

```bash
scp root@45.79.210.216:/opt/africoin/backups/africoin-*.sql.gz ./africoin-backups/
```

Check that a backup exists and is non-empty:

```bash
find /opt/africoin/backups -maxdepth 1 -type f -name '*.sql.gz' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort
```

Create a backup before every production migration and keep multiple historical copies.

## O. Database restoration

Restoration replaces rows in the selected database. Stop the application first so it cannot write during restoration:

```bash
cd /opt/africoin
docker compose --env-file .env -f deploy/docker-compose.yml stop app
CONFIRM_RESTORE=YES ./deploy/scripts/restore.sh /opt/africoin/backups/africoin-YYYYMMDDTHHMMSSZ.sql.gz
docker compose --env-file .env -f deploy/docker-compose.yml up -d app
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/health
```

Do not restore an untrusted dump. Keep the original backup until the application has been verified.

## P. Troubleshooting

### Docker container will not start

**Symptom:** `docker compose ps` shows `Exited` or `Restarting`.

**Cause:** The container failed during startup, often because a required variable is missing or the database is unavailable.

**Command to check:**

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 app
```

**Solution:** Fix the first error in the logs, validate Compose, and restart:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml config -q
docker compose --env-file .env -f deploy/docker-compose.yml up -d app
```

### Port already in use

**Symptom:** Compose cannot bind `127.0.0.1:3000`.

**Cause:** Another service is using the host port.

**Command to check:**

```bash
ss -ltnp | grep ':3000'
```

**Solution:** Stop the conflicting service or change `APP_PORT` in `.env`, then update Nginx to proxy to the new port.

### Database connection failed

**Symptom:** The app starts but database procedures fail.

**Cause:** The database is not healthy, `DATABASE_URL` uses `localhost`, or its credentials do not match the MySQL service.

**Command to check:**

```bash
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 db
```

**Solution:** In Compose, `DATABASE_URL` must use `db` as the host, not `127.0.0.1` or `localhost`. Confirm that `MYSQL_PASSWORD` matches the URL password.

### Drizzle migration failed

**Symptom:** The migration service exits non-zero.

**Cause:** A migration is invalid for the current schema, the database is unavailable, or a previous migration was interrupted.

**Command to check:**

```bash
docker compose --env-file .env -f deploy/docker-compose.yml --profile tools run --rm migrate
```

**Solution:** Back up the database, inspect the failed SQL and database state, correct the migration in source control, and rerun. Never replace this with `drizzle-kit push` against production.

### Nginx returns 502 Bad Gateway

**Symptom:** The domain responds with 502.

**Cause:** The app is stopped, the host port differs from Nginx, or Nginx is proxying to the wrong address.

**Command to check:**

```bash
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/health
docker compose --env-file .env -f deploy/docker-compose.yml ps
nginx -t
```

**Solution:** Start the app, make the Nginx upstream port match `APP_PORT`, and reload Nginx.

### Domain does not resolve

**Symptom:** `curl` reports DNS failure.

**Cause:** The A record is missing, incorrect, or still propagating.

**Command to check:**

```bash
getent hosts africoin.gowinrdc.com
```

**Solution:** Point the A record to `45.79.210.216`, wait for propagation, and retry.

### SSL certificate failure

**Symptom:** Certbot cannot validate the domain or Nginx fails its configuration test.

**Cause:** DNS is wrong, port 80 is blocked, the ACME challenge path is not served, or the certificate path is wrong.

**Command to check:**

```bash
ufw status
nginx -t
curl -I http://africoin.gowinrdc.com/.well-known/acme-challenge/test
```

**Solution:** Ensure ports 80 and 443 are open, use the bootstrap Nginx config, and rerun Certbot.

### API works locally but not in production

**Symptom:** The frontend loads but API calls fail through the domain.

**Cause:** Nginx is not forwarding `/api`, forwarded HTTPS headers are missing, or the app is bound to the wrong interface.

**Command to check:**

```bash
curl --fail https://africoin.gowinrdc.com/api/health
tail -f /var/log/nginx/error.log
```

**Solution:** Keep the Nginx proxy headers from `deploy/nginx/app.conf`, especially `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`.

### React loads but API calls fail

**Symptom:** The page is visible but data requests return errors.

**Cause:** The browser is using the wrong origin, the app is missing `DATABASE_URL` or `JWT_SECRET`, or a proxy rule is incomplete.

**Command to check:**

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 app
curl --fail https://africoin.gowinrdc.com/api/health
```

**Solution:** Keep the frontend and API on the same domain, verify the environment file, and inspect the browser Network panel for the failing `/api/trpc` request.

### CORS errors

**Symptom:** The browser blocks a request because of origin policy.

**Cause:** A separate frontend origin is being used without an explicit CORS policy.

**Command to check:**

```bash
curl -I https://africoin.gowinrdc.com/api/health
```

**Solution:** Prefer serving the built frontend and API from the same domain. Do not add a wildcard CORS policy for authenticated production traffic.

### Environment variable missing

**Symptom:** Compose rejects a required variable or the app reports a missing secret.

**Cause:** `.env` is absent, unreadable, or missing a required key.

**Command to check:**

```bash
test -f .env && chmod 600 .env
docker compose --env-file .env -f deploy/docker-compose.yml config -q
```

**Solution:** Copy `deploy/env.example`, fill every required value, and run the validation command again.

### Container keeps restarting

**Symptom:** Restart count increases continuously.

**Cause:** Startup failure, failed database connection, or a health check failure.

**Command to check:**

```bash
docker inspect --format '{{json .State.Health}}' africoin-app-1
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 app
```

**Solution:** Fix the earliest application error. Do not increase restart limits to hide a broken deployment.

### Permission errors

**Symptom:** Docker or backup scripts cannot read files.

**Cause:** The command is being run as a user without Docker access or the environment/backup file permissions are too broad or too restrictive.

**Command to check:**

```bash
id
docker info >/dev/null
ls -l .env backups
```

**Solution:** Add the user to the `docker` group, start a new session, keep `.env` at mode `600`, and create the backup directory with mode `700`.

### File upload errors

**Symptom:** Uploads fail or Nginx returns `413 Request Entity Too Large`.

**Cause:** Nginx or Express has a smaller request limit, or the optional Forge storage service is not configured.

**Command to check:**

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 app
grep client_max_body_size /etc/nginx/sites-enabled/africoin
```

**Solution:** The current app allows 50 MB in Express and the supplied Nginx config allows 50 MB. Configure both Forge variables when using Manus-backed storage.

### WebSocket connection errors

**Symptom:** Market data stays in fallback mode and the browser reports a WebSocket failure.

**Cause:** Nginx is not forwarding the Upgrade headers or a separate proxy is timing out the stream.

**Command to check:**

```bash
nginx -t
tail -f /var/log/nginx/error.log
docker compose --env-file .env -f deploy/docker-compose.yml logs -f app
```

**Solution:** Keep the dedicated `/api/market-stream` Nginx location, including `Upgrade`, `Connection`, HTTP/1.1, and the long read timeout.

## Q. Rollback procedure

Before an update, create a database backup and note the current Git commit:

```bash
cd /opt/africoin
./deploy/scripts/backup.sh
git rev-parse HEAD
```

If the new application image is broken but the schema is compatible, roll back the code:

```bash
git log --oneline -5
git checkout KNOWN_GOOD_COMMIT
SKIP_GIT_PULL=1 ./deploy.sh
```

If a migration has changed the schema, do not assume a code-only rollback is safe. Stop the app, restore the pre-migration backup, check out the known-good commit, rerun the migration service if needed, and restart the app:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml stop app
CONFIRM_RESTORE=YES ./deploy/scripts/restore.sh /opt/africoin/backups/PRE_MIGRATION_BACKUP.sql.gz
git checkout KNOWN_GOOD_COMMIT
SKIP_GIT_PULL=1 ./deploy.sh
```

Keep the failed commit and migration files available for diagnosis. Do not delete the data volume during rollback.

## R. Production security checklist

Before public launch, verify the following:

- The real `.env` is not committed and has mode `600`.
- `JWT_SECRET`, MySQL passwords, and Forge keys are long, unique, and not copied into logs.
- Only ports 22, 80, and 443 are allowed by the firewall.
- MySQL has no `ports` section in Compose and is private to the Compose network.
- The application is published only to `127.0.0.1` on the host.
- Nginx is the only public reverse proxy and forwards `X-Forwarded-Proto`.
- HTTPS is active and `certbot renew --dry-run` succeeds.
- The WebSocket proxy location is enabled for `/api/market-stream`.
- Backups are created before migrations and copied off the server.
- The production image runs as the non-root `node` user.
- No production deployment runs `drizzle-kit push` or a destructive reset.
- Optional Forge credentials are configured only if the corresponding feature is needed.
- Rate limiting and a formal monitoring/alerting service are still recommended before exposing high-volume public traffic.

## S. Final production checklist

Run the following after the first deployment:

```bash
cd /opt/africoin
docker compose --env-file .env -f deploy/docker-compose.yml config -q
docker compose --env-file .env -f deploy/docker-compose.yml ps
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/health
curl --fail https://africoin.gowinrdc.com/api/health
certbot renew --dry-run
./deploy/scripts/backup.sh
```

Then open the site in a browser and verify registration, login, logout, a protected route, the market catalog, notifications, and the WebSocket market stream. Confirm that a direct request to port 3000 is not reachable from the public Internet.

## T. Optional GitHub Actions deployment

Manual deployment remains the recommended first method:

```bash
git pull --ff-only
./deploy.sh
```

A future GitHub Actions workflow may SSH to the Linode server using repository secrets named `SSH_HOST`, `SSH_USER`, and `SSH_PRIVATE_KEY`, then run `cd /opt/africoin && ./deploy.sh`. Never put the private key, `.env`, database passwords, or Forge tokens in the repository or workflow source.

## Assumptions and remaining manual steps

This guide assumes the Linode server is a fresh Ubuntu host and that the application will use the self-hosted MySQL 8.4 service supplied by Compose. It also assumes the GitHub repository is accessible from the server. You must supply the real domain, DNS record, production secrets, and optional Forge credentials. You must install Nginx and Certbot on the host and replace the placeholder domain in the Nginx configuration. The Manus Forge storage proxy remains an optional external dependency; if it is not configured, features that depend on it will report that storage is unavailable rather than silently storing files locally.
