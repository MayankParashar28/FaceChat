# Use Node.js 20 as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
npm install
# Copy the entire application
COPY . .

# Build frontend (if needed)
RUN npm run build || true

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
