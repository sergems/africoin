# Africoin domain and Cloudflare SSL migration

This guide moves production from `africoin.gowinrdc.com` to `africointrading.com`, places the domain behind Cloudflare, and enables HTTPS between Cloudflare and the production server with a Cloudflare Origin Certificate.

## Target architecture

```text
Visitor
  |
  | HTTPS
  v
Cloudflare proxy: africointrading.com
  |
  | HTTPS / Full (strict)
  v
45.79.210.216:443
  |
  v
Nginx -> 127.0.0.1:3000 -> Africoin Docker app
```

Cloudflare's **Full (strict)** mode is recommended. It encrypts both connections and verifies the origin certificate.

## 1. Add the domain to Cloudflare

1. Sign in to [Cloudflare](https://dash.cloudflare.com/).
2. Select **Add a site**.
3. Enter `africointrading.com`.
4. Choose the plan and continue.
5. Cloudflare will show two authoritative nameservers.
6. At the registrar where `africointrading.com` was purchased, replace the existing nameservers with the two Cloudflare nameservers.
7. Wait until Cloudflare reports the site as **Active**.

Do not add the Cloudflare nameservers as DNS records. They must be configured at the domain registrar.

## 2. Create the DNS record

In **Cloudflare → DNS → Records**, create:

| Type | Name | IPv4 address | Proxy status | TTL |
| --- | --- | --- | --- | --- |
| A | `@` | `45.79.210.216` | Proxied / orange cloud | Auto |

Optional redirect for `www`:

| Type | Name | Target | Proxy status | TTL |
| --- | --- | --- | --- | --- |
| CNAME | `www` | `africointrading.com` | Proxied / orange cloud | Auto |

The application is configured for the apex domain. If `www` is used, add a Cloudflare Redirect Rule from `www.africointrading.com/*` to `https://africointrading.com/$1`.

Verify DNS after the nameservers are active:

```bash
dig +short africointrading.com
dig +short www.africointrading.com
```

Cloudflare may return anycast IP addresses instead of `45.79.210.216` when proxying is enabled. That is expected. The DNS record in the Cloudflare dashboard must point to `45.79.210.216`.

## 3. Configure Cloudflare SSL/TLS

In **Cloudflare → SSL/TLS → Overview**:

1. Set encryption mode to **Full (strict)**.
2. In **SSL/TLS → Edge Certificates**, keep **Always Use HTTPS** enabled.
3. Enable **Automatic HTTPS Rewrites** if the application embeds any HTTP assets.
4. Keep **Minimum TLS Version** at TLS 1.2 or higher.

Do not use **Flexible** mode. Flexible mode encrypts the browser-to-Cloudflare connection but leaves Cloudflare-to-Nginx unencrypted and can cause redirect loops.

## 4. Create a Cloudflare Origin Certificate

In **Cloudflare → SSL/TLS → Origin Server**:

1. Click **Create Certificate**.
2. Let Cloudflare generate the private key and certificate.
3. Include these hostnames:
   - `africointrading.com`
   - `*.africointrading.com` (optional, useful for future subdomains)
4. Use a long validity period permitted by your Cloudflare account.
5. Copy the **Origin Certificate** and **Private Key** immediately.

The private key is shown only during certificate creation. Treat it as a secret and never commit it to GitHub or paste it into a public issue.

## 5. Install the certificate on the production server

SSH into the server:

```bash
ssh root@45.79.210.216
cd /opt/africoin
```

Create a protected directory:

```bash
install -d -m 700 /etc/ssl/cloudflare
```

Create the certificate file and paste only the Cloudflare Origin Certificate into it:

```bash
nano /etc/ssl/cloudflare/africointrading.com.pem
chmod 644 /etc/ssl/cloudflare/africointrading.com.pem
```

Create the private-key file and paste only the Cloudflare Private Key into it:

```bash
nano /etc/ssl/cloudflare/africointrading.com.key
chmod 600 /etc/ssl/cloudflare/africointrading.com.key
chown root:root /etc/ssl/cloudflare/africointrading.com.pem /etc/ssl/cloudflare/africointrading.com.key
```

Confirm the files exist without printing the key:

```bash
openssl x509 -in /etc/ssl/cloudflare/africointrading.com.pem -noout -subject -dates
stat -c '%a %U:%G %n' /etc/ssl/cloudflare/africointrading.com.pem /etc/ssl/cloudflare/africointrading.com.key
```

## 6. Deploy the updated Nginx configuration

First update the application source and deployment files:

```bash
cd /opt/africoin
git remote set-url origin https://github.com/sergems/africoin.git
git fetch origin main
git reset --hard origin/main
```

Verify the new domain is present:

```bash
grep -Rni 'africointrading.com' deploy/nginx DEPLOYMENT.md
! grep -Rni 'africoin.gowinrdc.com' deploy/nginx DEPLOYMENT.md
```

Install the temporary HTTP configuration if Nginx is not configured yet:

```bash
apt update
apt install -y nginx
mkdir -p /var/www/certbot
cp deploy/nginx/app.bootstrap.conf /etc/nginx/sites-available/africoin
ln -sfn /etc/nginx/sites-available/africoin /etc/nginx/sites-enabled/africoin
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

Once the origin certificate files are installed, install the final HTTPS configuration:

```bash
cp deploy/nginx/app.conf /etc/nginx/sites-available/africoin
nginx -t
systemctl reload nginx
```

Verify Nginx and the local application:

```bash
systemctl is-active nginx
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/health
```

## 7. Deploy the application code

The domain change does not require a database migration, but use the normal safe deployment procedure so the running container matches GitHub:

```bash
cd /opt/africoin
./deploy.sh
```

If the server previously ran an old image and the new UI is not visible, force a clean rebuild:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml build --no-cache app migrate
docker compose --env-file .env -f deploy/docker-compose.yml up -d db
docker compose --env-file .env -f deploy/docker-compose.yml --profile tools run --rm migrate
docker compose --env-file .env -f deploy/docker-compose.yml up -d --force-recreate app
```

## 8. Verify through Cloudflare

```bash
curl --fail -I https://africointrading.com
curl --fail https://africointrading.com/api/health
```

Expected health response:

```json
{"status":"ok"}
```

Check the certificate presented by the public endpoint:

```bash
openssl s_client -connect africointrading.com:443 -servername africointrading.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Because the hostname is proxied, the public certificate will normally be a Cloudflare edge certificate. The origin certificate is used on the Cloudflare-to-server connection.

Also test in a browser:

- `https://africointrading.com`
- `https://africointrading.com/api/health`
- Login and open `/forex`
- Open `/admin/users` as the Super Admin

## 9. Rollback

If the new domain is not ready, keep the old Nginx configuration backed up before replacing it:

```bash
cp /etc/nginx/sites-available/africoin /etc/nginx/sites-available/africoin.before-domain-migration
```

To roll back Nginx:

```bash
cp /etc/nginx/sites-available/africoin.before-domain-migration /etc/nginx/sites-available/africoin
nginx -t
systemctl reload nginx
```

Do not delete the database volume. Never run `docker compose down -v` during this migration.

## Security checklist

- Keep the Cloudflare Origin Private Key outside Git.
- Keep `/etc/ssl/cloudflare/africointrading.com.key` mode `600`.
- Use Cloudflare **Full (strict)**, not Flexible.
- Keep ports 80 and 443 open; do not expose ports 3000 or 3306 publicly.
- Keep the Cloudflare DNS record proxied after origin HTTPS is working.
- Back up the database before application deployment:

```bash
cd /opt/africoin
./deploy/scripts/backup.sh
```
