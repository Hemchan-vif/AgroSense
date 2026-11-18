# Database Module

This directory contains the database initialization and seeding scripts.

## Seeding Demo Data

To populate the local MongoDB instance with demo data (User, Farm, Conversations):

1. Ensure MongoDB is running (e.g., via `docker-compose up -d mongodb`)
2. Run the seed script:
```bash
node seed.js
```

This will clear existing demo data and insert a fresh set of sample documents for testing the UI.
