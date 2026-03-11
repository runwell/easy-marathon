<div align="center">
  <h1>🏃 Easy Marathon</h1>
  <p>A lightweight, comprehensive framework for marathon runners to plan, manage, and track their training and racing goals.</p>

  <p>
    <a href="https://runwell.github.io/easy-marathon"><strong>View Live Demo</strong></a>
  </p>
  
  <p>
    <a href="https://github.com/runwell/easy-marathon/actions/workflows/deploy-pages.yml"><img src="https://github.com/runwell/easy-marathon/actions/workflows/deploy-pages.yml/badge.svg" alt="Deploy Pages Status"></a>
    <a href="https://github.com/runwell/easy-marathon/actions/workflows/deploy-workers.yml"><img src="https://github.com/runwell/easy-marathon/actions/workflows/deploy-workers.yml/badge.svg" alt="Deploy Workers Status"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="License"></a>
  </p>
</div>

<hr/>

**Easy Marathon** provides a suite of tools designed specifically for marathon enthusiasts, helping you organize your race calendar, track your daily training, calculate goal paces, and even track your progress towards the 50 States Marathon goal.

## ✨ Features \& Tools

### 📅 Tool 1: Race Calendar

Generates a personalized marathon race calendar based on your preferences. Plan your upcoming season by adding race names, dates, start times, and specific time zones to ensure you're always prepared.

### 📊 Tool 2: Training Log

A comprehensive dashboard to view and analyze your training activities. It supports various workout types including running, cycling, and strength training. Visualize your mileage build-up and training consistency.

- Has supported Garmin Connect integration to import the training data.
- Will support Coros and Strava integration to import the training data.

### 🗺️ Tool 3: 50 States Tracker

A visual tool to help runners track their progress toward the ultimate goal: completing a marathon in all 50 U.S. states.

- Includes a web scraper (`50states-tracker/collect_marathon_data.py`) that aggregates marathon data across the US.

### ⏱️ Tool 4: Pace Calculator

Eliminate the guesswork on race day. Calculate target splits and paces for various race distances (5k, 10k, Half, Full) based on your ultimate goal finish time.

### 🌎 Tool 5: World Athletics

Provides a comprehensive overview of current world athletics records to keep you inspired.

---

## 🚀 Getting Started

To run these tools locally and start contributing or modifying the framework for your own use:

### Prerequisites

- Node.js (v20 or higher recommended)
- Python 3.x (optional, for running data scraping scripts)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/runwell/easy-marathon.git
   cd easy-marathon
   ```

2. **Install frontend dependencies (hooks & formatting):**

   ```bash
   npm install
   ```

   _This initializes pre-commit hooks (Husky & lint-staged) and Prettier for code formatting._

3. **Install Worker dependencies (for backend API components):**

   ```bash
   cd workers
   npm install
   ```

4. **Run the Application:**
   Since the core tools are static HTML/JS/CSS, you can serve them locally using any static file server from the root directory. For example, using Python:
   ```bash
   python -m http.server 8000
   ```
   Then open `http://localhost:8000` in your browser.

---

## 🏗️ Architecture & Deployment

The modern iteration of Easy Marathon operates on a hybrid architecture:

- **Frontend:** Static files (HTML/CSS/JS) hosted on **GitHub Pages**, providing a fast, globally distributed UI without heavy framing.
- **Backend (Optional/Multi-User):**
  - Serverless functions powered by **Cloudflare Workers** (see the `/workers` directory).
  - Designed with the capability to integrate with backend services like **Supabase** for user authentication and synchronized data storage.

---

## 📁 Repository Structure

```text
easy-marathon/
├── 50states-tracker/      # The 50 states progress tracking tool & data scrapers
├── pace-calculator/       # Pace calculation logic and UI
├── race-calendar/         # Calendar and event planning components
├── training-view/         # Training log dashboard and Garmin data parsing
├── workers/               # Cloudflare Workers serverless backend
├── world-athletics/       # World records overview
├── .github/workflows/     # CI/CD pipelines for Pages and Workers
├── DEPLOYMENT.md          # Multi-user deployment architecture guide
└── index.html             # The main landing page connecting all tools
```

---

## 🤝 Contributing

Contributions make the open-source community an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Ensure Prettier formatting is applied (handled automatically on commit via Husky if `npm install` was run).
4. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the Branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

---

## 📝 License

Distributed under the **GNU General Public License v3.0**. See `LICENSE` for more information.
