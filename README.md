# Proxy Web Accessor

A web application that accesses websites through rotating HTTPS proxies scraped from [spys.one](https://spys.one/en/https-ssl-proxy/).

## Features

- 🔄 **Proxy Rotation** - Each request uses a different proxy
- 🌐 **Proxy Scraping** - Automatically scrapes HTTPS proxies from spys.one (with fallback sources)
- 🖥️ **Dual Mode** - Choose between headless browser (Puppeteer) or HTTP requests (Axios)
- 📊 **Real-time Stats** - Live progress tracking with success/fail counts
- 📝 **Live Logs** - Real-time logging via WebSocket (Socket.IO)
- 🎨 **Modern UI** - Dark theme with responsive design

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Proxy Scraping**: Axios, Cheerio
- **Headless Browser**: Puppeteer with Stealth Plugin
- **HTTP Requests**: Axios with HTTPS Proxy Agent

## Installation

```bash
# Clone or navigate to the project directory
cd proxy-web-accessor

# Install dependencies
npm install

# Start the server
npm start

# Or use nodemon for development
npm run dev
```

## Usage

1. Open your browser and go to `http://localhost:3000`
2. Enter the target URL you want to access
3. Set the total number of accesses (1-100)
4. Toggle between HTTP Request mode or Headless Browser mode
5. Click "Start Access" and watch the results in real-time

## How It Works

1. **Proxy Scraping**: The app scrapes HTTPS proxies from spys.one. If that fails, it falls back to other free proxy sources (free-proxy-list.net, GitHub proxy lists).

2. **Proxy Rotation**: Each access request uses a different proxy from the scraped list, ensuring no two consecutive requests use the same proxy.

3. **Access Modes**:
   - **HTTP Request (Axios)**: Fast, lightweight HTTP requests through the proxy
   - **Headless Browser (Puppeteer)**: Full browser rendering with stealth plugin to avoid detection

4. **Real-time Updates**: Socket.IO provides instant feedback on each request's status.

## Configuration

- Default port: `3000` (change via `PORT` environment variable)
- Request timeout: 30 seconds
- Delay between requests: 1 second
- Max total access: 100

## Notes

- Free proxies may be slow or unreliable
- Some proxies may be blocked by target websites
- Headless browser mode is slower but more reliable for JavaScript-heavy sites
- The app includes multiple fallback proxy sources for reliability

## License

MIT
