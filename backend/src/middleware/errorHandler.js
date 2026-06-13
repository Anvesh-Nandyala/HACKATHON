/**
 * Global error handler middleware.
 */
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${err.message}`, err.stack);

  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
