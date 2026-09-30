StellarCert - Wave Program Certificate System
A decentralized certificate program management system built on the Stellar blockchain using React, NestJS, and Stellar SDK. This system allows for issuing, verifying, and managing digital certificates program credentials in a secure, transparent, and immutable manner.

🚀 Getting Started

Get the stack running from a clean clone:

```bash
# 1. Install root dependencies (this does NOT populate backend/node_modules)
npm install

# 2. Install backend dependencies separately
(cd backend && npm install)

# 3. Create the compose environment file (docker compose reads ./.env)
#    Every value in .env.example is a required placeholder; docker-compose.yml
#    fails fast with ${VAR:?} if one is missing or empty.
cp .env.example .env

# 4. Start Postgres and Redis
docker compose up -d postgres redis

# 5. Copy the backend environment file
cp backend/.env.example backend/.env

# 6. Start development servers (backend :3000, frontend :5173)
npm run dev

# 7. Verify the API is running
curl http://localhost:3000/api/v1/health
```

> **Note on env vars:** The app starts with warnings for missing Stellar, Soroban, and storage config — this is fine for local development. Only `JWT_SECRET` and the database config (`DB_*`) are required to boot. See the [Configuration](#configuration) section for details.

🌟 Features
Core Features
Certificate Issuance: Authorized issuers can create digital certificates credentials

Real-time Verification: Anyone can verify the authenticity of certificates using Stellar transactions

Certificate Revocation: Issuers can revoke certificates when needed

Issuer Management: Admin can authorize/remove certificate issuers

Expiry Management: Automatic expiration of certificates based on Stellar sequence numbers

Statistics Dashboard: Track total certificates, active certificates, and issuer activity

**Soroban Smart Contract Integration**: On-chain certificate operations with multi-signature support

**Rate Limiting**: IP-based rate limiting on public verification endpoints for security

Technical Features
React Frontend: Modern, responsive UI with real-time updates

NestJS Backend: Scalable API with JWT authentication

**Soroban Smart Contracts**: Decentralized certificate management on Stellar blockchain

Stellar Integration: Smart contract-like functionality using Stellar transactions

**Security Features**: Rate limiting, authentication, and authorization

QR Code Generation: Easy certificate sharing and verification

PDF Export: Download certificates as PDF documents

🏗️ Project Structure

stellarcert/
├── frontend/ # React Application
│ ├── public/
│ ├── src/
│ │ ├── components/ # Reusable components
│ │ │ ├── Certificate/
│ │ │ ├── Dashboard/
│ │ │ ├── Issuer/
│ │ │ └── Shared/
│ │ ├── contexts/ # React contexts (Auth, Stellar)
│ │ ├── hooks/ # Custom React hooks
│ │ ├── pages/ # Page components
│ │ │ ├── Home/
│ │ │ ├── Verify/
│ │ │ ├── Issue/
│ │ │ ├── Dashboard/
│ │ │ └── Admin/
│ │ ├── services/ # API and Stellar services
│ │ ├── utils/ # Helper functions
│ │ ├── types/ # TypeScript definitions
│ │ └── styles/ # CSS/SCSS files
│ ├── package.json
│ └── vite.config.ts # or webpack.config.js
│
├── backend/ # NestJS Application
│ ├── src/
│ │ ├── modules/
│ │ │ ├── auth/ # Authentication
│ │ │ ├── certificate/# Certificate management
│ │ │ ├── issuer/ # Issuer management
│ │ │ ├── stellar/ # Stellar integration
│ │ │ └── user/ # User management
│ │ ├── common/
│ │ │ ├── guards/ # Auth guards
│ │ │ ├── filters/ # Exception filters
│ │ │ ├── interceptors/# Interceptors
│ │ │ └── decorators/ # Custom decorators
│ │ ├── config/ # Configuration files
│ │ ├── contracts/ # Smart contract ABIs (if using Soroban)
│ │ ├── database/ # Database models and migrations
│ │ │ ├── entities/
│ │ │ ├── migrations/
│ │ │ └── repositories/
│ │ └── utils/ # Utility functions
│ ├── test/ # Test files
│ ├── package.json
│ ├── nest-cli.json
│ └── tsconfig.json
│
├── stellar-contracts/ # Stellar Soroban Smart Contracts
│ ├── src/
│ │ ├── lib.rs # Main certificate contract
│ │ ├── multisig.rs # Multi-signature operations
│ │ ├── crl.rs # Certificate revocation lists
│ │ ├── types.rs # Shared types and data structures
│ │ └── admin_multisig.rs # Admin multisig functionality
│ ├── tests/ # Contract tests
│ └── Cargo.toml
│
├── shared/ # Shared code between frontend/backend
│ ├── types/ # Shared TypeScript types
│ ├── constants/ # Shared constants
│ └── utils/ # Shared utilities
│
├── docker/ # Docker configuration
│ ├── Dockerfile.frontend
│ ├── Dockerfile.backend
│ └── docker-compose.yml
│
├── docs/ # Documentation
│ ├── api/ # API documentation
│ ├── stellar/ # Stellar integration docs
│ └── deployment/ # Deployment guides
│
├── scripts/ # Utility scripts
│ ├── setup-stellar.js
│ ├── deploy-contracts.js
│ └── seed-database.js
│
├── .env.example # Environment variables template
├── .gitignore
├── package.json # Root package.json (workspace)
├── README.md # This file
├── LICENSE
└── docker-compose.yml # Full stack docker compose

📋 Prerequisites
Required Software
Node.js (v18 or higher)

npm or yarn or pnpm

Docker & Docker Compose (required for Postgres and Redis in local dev)

Stellar CLI Tools (for contract deployment)

Stellar Requirements
Stellar Testnet/Livenet account

Stellar SDK (@stellar/stellar-sdk)

Friendbot (for testnet funding)

🚀 Installation

1. Clone the Repository
   bash
   git clone https://github.com/Servora/StellarCert.git
   cd stellarcert
2. Setup Backend
   bash
   cd backend
   cp .env.example .env

# Edit .env with your configuration

npm install
npm run db:migrate
npm run seed 3. Setup Frontend
bash
cd ../frontend
cp .env.example .env
npm install 4. Setup Stellar (Optional - for contract deployment)
bash
cd ../stellar-contracts
rustup target add wasm32-unknown-unknown
cargo install --locked soroban-cli
🏃‍♂️ Running the Application
Development Mode
Option A: Using Docker Compose (Recommended)
bash

# From root directory

docker-compose up --build
Option B: Running Separately
Backend:

bash
cd backend
npm run start:dev
Frontend:

bash
cd frontend
npm run dev
Production Mode
bash

# Build all services

npm run build

# Start in production

npm start
🧪 Testing
Backend Tests
bash
cd backend
npm test # Unit tests
npm run test:e2e # E2E tests
npm run test:cov # Test coverage
Frontend Tests
bash
cd frontend
npm test # Unit tests
npm run test:e2e # E2E tests
Frontend Linting
bash
cd frontend
npm run lint # ESLint 9 flat config (eslint.config.js)
Stellar Contract Tests
bash
cd stellar-contracts
cargo test
🔧 Configuration
Environment Variables

**Required to boot:**
- `JWT_SECRET` — any string works for local development (e.g. `dev-secret`)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` — defaults in `.env.example` match `docker compose`

**Optional (the app will start with warnings):**
- `STELLAR_ISSUER_SECRET_KEY` / `STELLAR_ISSUER_PUBLIC_KEY` — only needed for certificate operations
- `SENTRY_DSN` / `ENABLE_SENTRY` — error reporting
- `STORAGE_*` — file storage (S3/MinIO)  
- `AUDIT_RETENTION_DAYS`, `DUPLICATE_DETECTION_*` — feature toggles with safe defaults

Backend (.env):

env

# Database

DATABASE_URL=postgresql://user:password@localhost:5432/stellarwave

# Stellar

STELLAR_NETWORK=TESTNET
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SECRET_KEY=your_secret_key

# JWT

JWT_SECRET=your_jwt_secret
JWT_EXPIRY=24h

# Server

PORT=3000
CORS_ORIGIN=http://localhost:5173
Frontend (.env):

env
VITE_API_URL=http://localhost:3000/api/v1
VITE_STELLAR_NETWORK=TESTNET
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
📡 API Base URL & Versioning
The backend applies a global `api` prefix and URI-based versioning with default version `1` (see `backend/src/main.ts`):

```
app.setGlobalPrefix('api');
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

Every route is therefore served under `/api/v1/...`. A plain `/api/...` path returns **404** — this has caused issues in docker-compose and healthcheck configs in the past.

Base URL (local dev):
```
http://localhost:3000/api/v1
```

Quick smoke-test (health check):
```bash
curl http://localhost:3000/api/v1/health
```

The Swagger UI (available at `http://localhost:3000/api/docs` in development) reflects the versioned paths — all routes shown there include the `/v1/` segment.

**Important for configuration:** make sure environment variables that point at the API use the versioned base URL:
```env
# ✅ Correct
VITE_API_URL=http://localhost:3000/api/v1

# ❌ Wrong — returns 404
VITE_API_URL=http://localhost:3000/api
```

📡 Stellar Integration
Key Components
Transaction Builder: Creates Stellar transactions for certificate operations

Account Manager: Handles issuer and user accounts

Memo Fields: Uses memo fields to store certificate metadata

Operations:

Issue: Creates trustlines and sends assets

Verify: Checks transaction history

Revoke: Updates account flags

Smart Contract Flow (Soroban)
rust
// Example Soroban contract function
fn issue_certificate(
env: Env,
issuer: Address,
recipient: Address,
cert_data: Bytes
) -> Result<(), Error>;
🤝 Contributing
Fork the repository

Create a feature branch (git checkout -b feature/AmazingFeature)

Commit changes (git commit -m 'Add some AmazingFeature')

Push to branch (git push origin feature/AmazingFeature)

Open a Pull Request

📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

📞 Support
For support open an issue in the GitHub repository.
