# 🚀 PHASE 0 — Define scope (avoid over-engineering)

## 🎯 MVP requirements

- Multi-entity comments (`entity_type`, `entity_id`)
- Tree comments (Materialized Path)
- Basic CRUD operations
- API usable in Next.js
- CLI for DB migrations

👉 Out of scope for now:

- realtime
- notifications
- likes/reactions

---

# 🏗 PHASE 1 — Core Design (most important)

## 1.1 Database schema

```
comments:
- id (bigint)
- entity_type (varchar)
- entity_id (varchar)
- user_id (varchar)
- content (text)

- path (varchar) -- materialized path
- depth (int)

- parent_id (nullable)
- created_at
- updated_at
- deleted_at
```

---

## 1.2 Indexes

```
INDEX(entity_type, entity_id, path)
INDEX(parent_id)
INDEX(user_id)
```

---

## 1.3 Path strategy (CRITICAL)

👉 decide early on:

**Option A (simple)**

```
1/2/3
```

**Option B (recommended)**

```
0001/0002/0003
```

👉 to avoid sorting bugs later on

---

# ⚙️ PHASE 2 — Core service layer

## 2.1 Internal APIs (SDK)

```
createComment()
getComments()
deleteComment()
updateComment()
```

---

## 2.2 Main logic

### createComment

```
1. insert comment (no path)
2. if root:
     path = id
   else:
     path = parent.path + "/" + id
3. update path + depth
```

---

### getComments

```
SELECT *
FROM comments
WHERE entity_type = ?
AND entity_id = ?
ORDER BY path
```

👉 return flat list → frontend builds the tree

---

## 2.3 Tree builder (optional)

```
buildTree(comments)
```

👉 convert flat list → nested JSON tree

---

# 🔌 PHASE 3 — Next.js Adapter

## 3.1 Ready-to-use API routes

```
// app/api/comments/route.ts
export { GET, POST } from "your-package/api";
```

---

## 3.2 Handlers

```
POST /api/comments
GET /api/comments?entityType=post&entityId=123
```

---

👉 Note:

- does not handle authentication
- takes `userId` from the request

---

# 🎨 PHASE 4 — React UI (the differentiator)

## 4.1 Components

```
<CommentBox entityType="post" entityId="123" />
```

---

## 4.2 Features

- render tree
- reply functionality
- load more
- optimistic UI

---

👉 Doing this well makes the package truly valuable

---

# 🗄 PHASE 5 — Migration system

Use Knex.js

---

## 5.1 CLI

```
npx your-package migrate
```

---

## 5.2 bin/cli.js

- migrate commands
- rollback commands

---

## 5.3 DB Configuration

```
DB_URL=mysql://...
```

---

# 📦 PHASE 6 — Package structure

```
your-package/
├── src/
│   ├── core/ # services
│   ├── db/
│   ├── api/
│   ├── react/
│   └── index.ts
├── migrations/
├── bin/
├── dist/
├── package.json
```

---

# ⚡ PHASE 7 — Build system

Using:

- TypeScript
- tsup

```
"scripts": {
  "build": "tsup src/index.ts --format cjs,esm --dts"
}
```

---

# 🧪 PHASE 8 — Testing (do not skip)

## Required tests:

- create root comment
- reply to comment
- deep tree interactions (5–10 levels)
- query performance testing

---

# 🚀 PHASE 9 — Publish to npm

```
npm publish
```

---

👉 remember to:

- use a unique package name
- follow semantic versioning

---

# 🔥 PHASE 10 — Version 2 roadmap

Once the MVP is stable:

### Upgrades

- likes/reactions
- cursor-based pagination
- Redis caching
- rate limiting
- user mentions (@user)

---

# 💡 Overall Architecture

```
Core (Materialized Path + services)
        ↓
Adapter (Next.js APIs)
        ↓
UI (React Components)
        ↓
CLI (migrations)
```

---

# ⚠️ Common Pitfalls (from real experience)

## 1. Malformed paths → breaks the entire tree

→ fix: strictly normalize paths from the beginning

---

## 2. Slow queries

→ missing `(entity_type, entity_id, path)` index

---

## 3. UI lag

→ tree is too deep

→ fix: limit depth / implement lazy loading

---

## 4. DB Locking during bulk inserts

→ fix:

- use batch inserts
- queue system (for the future)

---

# 🎯 Conclusion

This plan ensures the package is:

- ✅ reusable across any Next.js project
- ✅ highly scalable
- ✅ easy to publish on npm
- ✅ capable of evolving into a SaaS (like a mini-Disqus)