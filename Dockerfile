# Use Node.js 20 as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
npm install --legacy-peer-deps
# Copy the entire application
COPY . .

# Build frontend (if needed)
RUN npm run build
# Prune devDependencies for production
RUN npm prune --omit=dev

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
