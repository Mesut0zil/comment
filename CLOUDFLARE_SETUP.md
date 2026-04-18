# Cloudflare Setup Guide for the Comment System

Since the Comment System is designed for High-Concurrency with automated polling every 5 seconds, the volume of requests sent to the server will be massive. Cloudflare acts as our **Shield (Edge Cache)** and **Spam Protection (WAF Rate Limiting)** before requests touch the Origin Server (Next.js).

Below are the Expression Rules you need to configure on your Cloudflare Dashboard to maximize backend performance.

---

## 1. Cache Rules Configuration (Mandatory)

By default, Cloudflare **DOES NOT** cache API endpoints (e.g., `/api/*`). We must force Cloudflare to recognize the comment API and automatically cache it according to the `Cache-Control` header (e.g. `s-maxage=10`) configured by the backend.

- Navigate to **Caching** > **Cache Rules** in the Cloudflare dashboard.
- Click **Create rule**.
- **Rule name**: `Cache Comment Polling`

### Expression:
*Only cache GET (read) requests sent to the comment API path.*
```text
(starts_with(http.request.uri.path, "/api/comments") and http.request.method eq "GET")
```

### Cache eligibility settings:
- Select **Eligible for cache**.
- **Edge TTL**: Select **Use cache-control header if present, bypass cache if not**.
  *(Our backend already returns `Cache-Control: public, max-age=0, s-maxage=10, stale-while-revalidate=20`. Cloudflare will respect this and cache responses at the Edge for 10 seconds).*

---

## 2. Rate Limiting Configuration (WAF)

Although we have implemented a robust logic-based spam prevention module using Redis, blocking requests directly at the Cloudflare Edge safeguards the origin server against DoS attacks, saving 100% of CPU/DB resources. Since we have compartmentalized API methods in the backend, you can replicate this separation on Cloudflare using two different rules.

- Navigate to **Security** > **WAF** > **Rate limiting rules**.
- Click **Create rule**.

### Rule 1: Throttling Write Operations (POST, PUT, DELETE)
This prevents comment spamming and abuse from automated tools repeatedly hitting our mutative endpoints.

- **Rule name**: `Limit Spam Comments`
- **Expression**:
  ```text
  (starts_with(http.request.uri.path, "/api/comments") and http.request.method ne "GET")
  ```
- **Action**: `Block` (or `Managed Challenge` if you prefer to show a Captcha instead of outright rejection).
- **With the same characteristics**: `IP` (Client IP) or specific `Headers`.
- **When requests exceed / Rate Limit**:
  - `10` requests
  - **Period**: `10 seconds` *or* `1 minute` depending on your operational strictness.
  *(The internal Next.js API rate-limiting thresholds were recently configured. You should align the WAF thresholds so they are equal to or slightly higher than the internal limits).*

### Rule 2: Anti-Scraping for Polling (GET)
Even though GET requests are cached, malicious actors could still attempt Cache-buster attacks by appending random query parameters (like `?cursor=random_id`) to bypass the Edge cache. 

- **Rule name**: `Throttling Comment Loaders`
- **Expression**:
  ```text
  (starts_with(http.request.uri.path, "/api/comments") and http.request.method eq "GET")
  ```
- **Action**: `Managed Challenge` *(legitimate users whose app polls normally every 5 seconds will never hit this limit, so only automated scrapers will trigger the CAPTCHA).*
- **When requests exceed / Rate Limit**:
  - `60` requests
  - **Period**: `1 minute` (The default application behavior expects around 12 requests/minute. Hitting 60 indicates deliberate scraping).
  - **Mitigation timeout**: `10 minutes` (Keep the offending IP challenged/blocked long enough to deter the scraper).

---

## 3. Administrator Bypass Advice

> [!TIP]
> Configuring the Cloudflare Caching Layer correctly will account for 90% of your server's survivability when a video goes viral (effectively generating tens of thousands of concurrent views and dozens of new comments per second). With this setup in place, read queries against the database will drop to near zero, leaving your server free to solely handle ingesting new comments into Redis.

If you have webhooks or internal Admin Tools that interact heavily with the API backend from official IP addresses, consider creating an overlapping **WAF Custom Rule** at the top priority that uses `Skip` -> `Rate limiting rules` for those specific IP addresses. This will prevent your administrative tasks from being erroneously blocked by Cloudflare.
