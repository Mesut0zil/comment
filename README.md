# @inhouse/comment

A high-performance, strictly-typed, and highly configurable hierarchical commenting library designed for Next.js and React applications.

Built on **Materialized Paths** for database queries, meaning deeply nested comment trees are retrieved in a single, fast SQL query without typical recursive performance bottlenecks.

## 🚀 Integration Guide (For Main Projects)

Follow these steps to integrate the comment package into another project (e.g., a Next.js app) that already has an existing Database and Knex pool:

### Step 1: Install the Package

Since this project is hosted on GitHub, you can install it directly into your main project via the repository URL:

```bash
npm install github:inhvn/comment
# or
yarn add github:inhvn/comment
```
*(Note: Your main project must have `react`, `react-dom`, and `knex` installed as they are required peer dependencies).*

---

### Step 2: Migrate Database (Creating the `comments` table)

The package requires a `comments` table to be created in your database. You have two ways to run the migration:

**Option 1: Using `.env` for CLI (Standalone)**  
Make sure your existing project's `.env` contains the required variables:
```env
COMMENT_DB_URL=mysql2://user:pass@localhost:3306/mydb
COMMENT_TABLE_NAME=comments
```
Then run the migration script:
```bash
node node_modules/comment/bin/cli.js migrate
```

**Option 2: Programmatically via Code (Recommended for CI/CD)**  
You can require the package and directly inject your MAIN PROJECT's existing Knex connection:
```typescript
import { configure, up } from 'comment';
import { db } from '@/lib/db'; // The existing Knex instance in your main project

// The Comment package will execute migrations using your existing connection pool
configure({ knexInstance: db, tableName: 'comments' });

await up(); // Initializes the table
```

---

### Step 3: Setup Backend API (Next.js Route Example)

The package bundles an API Controller that handles all standard HTTP operations (GET, POST, PUT, DELETE). You just need to connect the Next.js router to this handler.

In your Next.js App Router (create a file `app/api/comments/route.ts`):

```typescript
import { configure } from 'comment/dist/core/config';
import { createCommentsHandler } from 'comment/dist/api';
import { db } from '@/lib/db'; // Your main project's Knex instance

// 🔥 Crucial: Map the Database Context from the Main Project to the Comment package
configure({
  knexInstance: db, 
});

// Inject the operations into NextRequest standard HTTP formats (Next 13+)
const handler = createCommentsHandler();

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
```

---

### Step 4: Frontend Integration (React UI)

You can easily render the pre-built `<CommentSection />` UI component anywhere in your frontend.

It automatically handles data fetching, layered tree rendering, and internal post/reply actions out of the box:

```tsx
// Example Page: app/video/[id]/page.tsx
import { CommentSection } from 'comment/dist/react';
import { useAuth } from '@/hooks/useAuth'; // Custom auth hook from your system

export default function VideoPage({ params }) {
  const { user } = useAuth(); // Retrieve current user data

  return (
    <main>
      <h1>Episode Content</h1>
      
      {/* 
        `entityPath` defines the root ID containing the Comment. 
        By configuring it as a Path Hierarchy, you can easily aggregate comments later. 
        Example: "video:1/episode:2" 
      */}
      <CommentSection 
        entityPath={`video:${params.id}/episode:${params.episodeId}`}
        apiPath="/api/comments" // Maps to the API route you created in Step 3
        currentUser={user ? { id: user.id, name: user.name } : undefined} 
      />
    </main>
  );
}
```

---

## Hierarchy Feature (Advanced Querying)

The most powerful aspect of this package's database architecture is its support for multi-level **Wildcard** queries.

What if a user comments on a specific episode (`video:A/episode:4`), but you want to load ALL comments for the entire "Video A" regardless of the episode on your Video Admin Dashboard?

There is no need for loop requests or calling separate APIs. Our codebase already handles `PREFIX LIKE` queries natively. You can call the service directly in a Node context:

```typescript
import { getComments } from 'comment';

// Fetches ALL comments whose target starts with 'video:A/' (Includes ep1, ep2... ep.n)
const allVideoComments = await getComments({ entity_path_prefix: 'video:A/' });
```
