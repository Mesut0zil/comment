# @inhouse/comment

A high-performance, strictly-typed, and highly configurable hierarchical commenting library designed for Next.js and React applications.

Built on **Materialized Paths** for database queries, meaning deeply nested comment trees are retrieved in a single, fast SQL query without typical recursive performance bottlenecks.

## Features

- ⚡️ **Materialized Paths**: Instant deep-tree loading using exact prefix sorting logic (e.g., `0001/0002/0003`).
- 📁 **Entity Hierarchy Support**: Query comments at an exact entity level (e.g., `video:1/episode:4`) or fetch all comments across a parent group using a wildcard prefix (`video:1/%`).
- 🛠️ **Loose Configuration**: Inject your own `knex` instance directly to share database pools, or configure via `.env` variables independently.
- 🚀 **Next.js & React Ready**: Exported API route handlers and a generic, customizable React `<CommentSection />` component.
- 📦 **Automated Migrations**: Includes a built-in CLI and programmatic exporters to execute Knex table creation seamlessly.

## Installation

```bash
npm install # add to your monorepo workspace or project
```

*(Note: Ensure you have `react`, `react-dom`, and `knex` installed in your host project as they are peer dependencies).*

## Configuration

You can configure the library globally in your application startup (e.g., inside an API route or a central database initialization file) or strictly via environment variables.

### Using `.env`
```env
COMMENT_DB_URL=mysql2://user:pass@localhost:3306/mydb
COMMENT_TABLE_NAME=comments
```

### Using Code Injection
```typescript
import { configure } from 'comment'; // Requires setting up package aliases
import { db } from '@/lib/db'; // Your existing Knex instance

configure({
  knexInstance: db,
  tableName: 'custom_comments_table',
});
```

## Migrations

The package comes with an executable CLI to spin up the required tables automatically.

To run via CLI:
```bash
node node_modules/comment/bin/cli.js migrate
```

Or you can trigger it programmatically inside your backend pipeline:
```typescript
import { up, down } from 'comment';

await up(); // Creates the comments table with proper indexes
// await down(); // Drops the comments table
```

## Usage

### 1. Next.js API Route (App Router)

Create standard route handlers in your Next.js application at `app/api/comments/route.ts`:

```typescript
import { createCommentsHandler } from 'comment/dist/api';

const handler = createCommentsHandler();

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
```

### 2. React UI Integration

Import the out-of-the-box `<CommentSection />` into your frontend. It inherently manages the network fetching, tree rendering, and recursive nested reply states directly.

```tsx
import { CommentSection } from 'comment/dist/react';

export default function EpisodePage() {
  // Use your auth provider here
  const user = { id: 'user_123', name: 'John Doe' };

  return (
    <main>
      <h1>Episode 4</h1>
      
      <CommentSection 
        entityPath="video:A/episode:4" 
        apiPath="/api/comments"
        currentUser={user} 
      />
    </main>
  );
}
```

### 3. Querying by Parent Hierarchy Programmatically

Because of the `entity_path` architecture, you aren't forced to fetch comments only for a strictly bound page. If you want to show "All Comments for Video A" (aggregating across all child episodes), you can query by a prefix wildcard:

```typescript
import { getComments } from 'comment';

// Fetches ALL comments starting with 'video:A/'
const allVideoComments = await getComments({ entity_path_prefix: 'video:A/' });
```
