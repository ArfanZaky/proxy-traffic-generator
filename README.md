# Proxy Traffic Generator

A high-volume web traffic generator that accesses websites through rotating HTTPS proxies scraped from multiple sources.

## Features

- 🔄 **Proxy Rotation** — Each request uses a different proxy for anonymity
- 🌐 **Auto Proxy Scraping** — Automatically scrapes HTTPS proxies from spys.one (with fallback sources)
- 🖥️ **Dual Mode** — Choose between headless browser (Puppeteer) or HTTP requests (Axios)
- 📊 **Real-time Stats** — Live progress tracking with success/fail counts
- 📝 **Live Logs** — Real-time logging via WebSocket (Socket.IO)
- 🎨 **Modern UI** — Dark theme with responsive design
- 🔁 **Loop & Concurrency** — Configurable parallel requests and loop count
- ✅ **Verify URL** — Test proxy against a verify URL before hitting the target

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Proxy Scraping**: Axios, Cheerio
- **Headless Browser**: Puppeteer with Stealth Plugin
- **HTTP Requests**: Axios with HTTPS/SOCKS Proxy Agent

## Installation

```bash
# Clone the repository
git clone https://github.com/ArfanZaky/proxy-traffic-generator.git
cd proxy-traffic-generator

# Install dependencies
npm install

# Start the server
npm start

# Or use nodemon for development
npm run dev
```

## Usage

1. Open your browser and go to `http://localhost:3201`
2. Enter one or more target URLs (one per line)
3. Optionally set a Verify URL to test proxies before use
4. Configure total access count, concurrency, and delay
5. Toggle between HTTP Request mode or Headless Browser mode
6. Click **"Start Access"** and watch the results in real-time

## How It Works

1. **Proxy Scraping**: Scrapes HTTPS proxies from spys.one. Falls back to other free proxy sources (free-proxy-list.net, GitHub proxy lists) if needed.

2. **Proxy Rotation**: Each access request uses a different proxy from the scraped list, ensuring distribution across IPs.

3. **Verify Step**: If a Verify URL is set, the proxy is tested first. Only proxies returning status 200 proceed to the target.

4. **Access Modes**:
   - **HTTP Request (Axios)**: Fast, lightweight HTTP requests through the proxy
   - **Headless Browser (Puppeteer)**: Full browser rendering with stealth plugin to avoid detection

5. **Real-time Updates**: Socket.IO provides instant feedback on each request's status.

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| Port | `3201` | Change via `PORT` env variable |
| Total Access | 50 | Max: 10,000 |
| Concurrency | 10 | Parallel requests (max 50) |
| Min Delay | 200ms | Minimum delay between requests |
| Max Delay | 1000ms | Maximum delay between requests |
| Loop Count | 1 | Number of loops (configurable) |

## Notes

- Free proxies may be slow or unreliable
- Some proxies may be blocked by target websites
- Headless browser mode is slower but more reliable for JavaScript-heavy sites
- The app includes multiple fallback proxy sources for reliability

## License

MIT
