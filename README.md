# Bitespeed Identity Reconciliation

A backend service that identifies and links customer contacts across multiple purchases, even when they use different emails or phone numbers.

Built for the [Bitespeed Backend Task](https://bitespeed.notion.site/Bitespeed-Backend-Task-Identity-Reconciliation-53392ab01fe149fab989422300423199).

---

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express
- **Database**: PostgreSQL
- **ORM**: Prisma

---

## Project Structure

```
src/
├── server.ts            # Express app and route handler
├── identity.service.ts  # All reconciliation business logic
├── contactService.ts    # Re-export for backward compatibility
└── prisma.ts            # Prisma client singleton

prisma/
└── schema.prisma        # Database schema
```

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/kartik-singhhh03/bitspeed_assign.git
cd bitspeed_assign
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the root directory:

```env
DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/bitespeed"
```

### 4. Run database migration

This creates the `Contact` table in your PostgreSQL database:

```bash
npx prisma migrate dev --name init
```

### 5. Start the development server

```bash
npm run dev
```

The server runs at `http://localhost:3000`

---

## API

### Health Check

```
GET /
```

**Response**
```json
{
  "status": "ok",
  "message": "Bitespeed Identity Reconciliation API is running"
}
```

---

### Identify Contact

```
POST /identify
```

**Request Body**

```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

At least one of `email` or `phoneNumber` must be provided.

**Response**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["mcfly@hillvalley.edu", "mcfly@gmail.com"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2, 3]
  }
}
```

---

## Example Scenarios

### New contact — no match found

**Request**
```json
{ "email": "new@example.com", "phoneNumber": "9999999999" }
```

**Result**: A new primary contact is created.

---

### Existing contact — same email or phone

**Request**
```json
{ "email": "new@example.com", "phoneNumber": "0000000000" }
```

**Result**: The new phone number is linked as a secondary under the existing primary.

---

### Two clusters merging

When a request contains an email from one cluster and a phone from another, both clusters get merged. The older primary stays primary; the newer one is converted to secondary.

---

## Hosted URL

```
https://YOUR_DEPLOYED_URL/identify
```

> Replace with your actual deployed URL (Render / Railway / etc.)

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npx prisma migrate dev` | Run database migrations |
| `npx prisma generate` | Regenerate Prisma client |
| `npx prisma studio` | Open visual database browser |
