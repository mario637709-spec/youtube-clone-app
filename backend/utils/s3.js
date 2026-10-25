const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// S3 Client configuration. This works out-of-the-box for AWS S3, Cloudflare R2, Backblaze B2, MinIO.
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || ''
  }
});

const uploadToS3 = async (buffer, mimetype, filename) => {
  if (!process.env.S3_BUCKET) {
    throw new Error('S3_BUCKET is not defined in environment variables');
  }

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: filename,
    Body: buffer,
    ContentType: mimetype,
    // Note: ACL 'public-read' may not be supported on all Cloudflare R2 buckets depending on settings,
    // but it's standard for public video hosting.
    // ACL: 'public-read' 
  });

  await s3Client.send(command);

  // Return the public URL
  // If S3_PUBLIC_DOMAIN is defined (e.g. for R2 custom domains or Cloudfront), use it.
  if (process.env.S3_PUBLIC_DOMAIN) {
    return `${process.env.S3_PUBLIC_DOMAIN}/${filename}`;
  }
  
  // Fallback to standard virtual-hosted style URL (may not work out-of-box for some non-AWS providers)
  if (process.env.S3_ENDPOINT) {
    // Basic construction for path-style endpoints (like MinIO)
    const url = new URL(process.env.S3_ENDPOINT);
    return `${url.protocol}//${process.env.S3_BUCKET}.${url.host}/${filename}`;
  }

  return `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com/${filename}`;
};

module.exports = {
  s3Client,
  uploadToS3
};
