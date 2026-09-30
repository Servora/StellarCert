# SSL Certificates for Production

This directory should contain your SSL/TLS certificates for HTTPS.

## Required Files

- `cert.pem` - Your SSL certificate file
- `key.pem` - Your private key file

## Quick Setup for Testing

Generate self-signed certificates for local testing:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem \
  -out nginx/ssl/cert.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

**Note:** Self-signed certificates will cause browser warnings. Only use for development/testing.

## Production Setup with Let's Encrypt

1. Install certbot on your host machine
2. Run certbot to generate certificates:
   ```bash
   certbot certonly --standalone -d yourdomain.com
   ```
3. Copy the generated certificates to this directory:
   ```bash
   cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/cert.pem
   cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/key.pem
   ```

## Security Notes

- **Never commit** actual certificate files to version control
- Keep private keys secure and never share them
- Use strong encryption (at least 2048-bit RSA or 256-bit ECC)
- Set proper file permissions: `chmod 600 key.pem`

## Docker Compose Usage

When running with the production profile, nginx will mount this directory:

```bash
docker-compose --profile production up -d
```

The certificates will be available at `/etc/nginx/ssl/` inside the nginx container.
