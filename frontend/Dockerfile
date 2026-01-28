# Simple dev-focused Docker image for the frontend
# - Runs the Vite dev server inside the container
# - Good for local development and preview environments

FROM node:18

# Set working directory inside the container
WORKDIR /app

# Install dependencies first (leverages Docker layer caching)
COPY package*.json ./
RUN npm install

# Copy the rest of the frontend source code
COPY . .

# Vite's default dev port is 5173
EXPOSE 5173

# Start the dev server
CMD ["npm", "run", "dev"]