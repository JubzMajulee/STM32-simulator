# HIL System Simulator - Setup Guide

This guide details how to set up the HIL (Hardware-in-the-Loop) Simulator locally using Vite and React.

## 1. Prerequisites
Ensure you have the following installed on your machine:
* **Node.js** (v18.0 or higher)
* **npm** (comes with Node.js)

## 2. Project Initialization
Open your terminal and run the following commands to create and configure the project:

```bash
# Create the project
npm create vite@latest hil-simulator -- --template react
cd hil-simulator

# Install dependencies
npm install

# Install UI and utility libraries
npm install lucide-react
npm install -D tailwindcss postcss autoprefixer