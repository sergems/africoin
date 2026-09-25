# Africoin deployment files

The complete Linode Ubuntu deployment guide is in [`../DEPLOYMENT.md`](../DEPLOYMENT.md). It covers Docker, MySQL, Nginx, DNS, Certbot, migrations, backups, restoration, rollback, updates, and troubleshooting.

| Path                       | Purpose                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`       | Private MySQL service, app service, and one-off migration profile.                                        |
| `env.example`              | Safe template for the real server `.env`; replace every placeholder and keep the real file at mode `600`. |
| `nginx/app.bootstrap.conf` | Temporary HTTP-only proxy used while obtaining the first Let's Encrypt certificate.                       |
| `nginx/app.conf`           | Final HTTPS reverse proxy for `africoin.gowinrdc.com` with API and WebSocket forwarding.                 |
| `scripts/deploy.sh`        | Fast-forward-only pull, image build, migration, restart, and health check.                                |
| `scripts/backup.sh`        | Compressed MySQL backup with restrictive permissions.                                                     |
| `scripts/restore.sh`       | Explicit-confirmation MySQL restore.                                                                      |

From the repository root, the normal update command is:

```bash
./deploy.sh
```

The Docker and Nginx binaries are intentionally host concerns; install them on the Linode according to the main guide rather than adding them to the application image.
