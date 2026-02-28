/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath: process.env.NODE_ENV === 'production' ? '/derech-tzlecha' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/derech-tzlecha/' : '',
}

module.exports = nextConfig