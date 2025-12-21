# Care Scheduling System - Backend

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start MongoDB
```bash
# macOS
brew services start mongodb-community

# Ubuntu
sudo systemctl start mongodb

# Or use MongoDB Atlas (cloud)
```

### 4. Run Development Server
```bash
npm run dev
```

Server will start on http://localhost:5000

## API Endpoints

- `POST /api/auth/register` - Register new admin
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `POST /api/auth/change-password` - Change password

More endpoints documented in API_DESIGN.md

## Testing

```bash
# Run tests
npm test

# With coverage
npm run test:coverage
```

## Scripts

- `npm start` - Production server
- `npm run dev` - Development server with auto-reload
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier

## Environment Variables

See `.env.example` for all required variables.

## Documentation

See design documents in /outputs folder.
