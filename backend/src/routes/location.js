const express = require('express');
const { geocodeAddress } = require('../services/geocoding');

const router = express.Router();

router.post('/geocode', async (req, res, next) => {
  try {
    const { address } = req.body;
    const location = await geocodeAddress(address);
    res.json({
      latitude: location.latitude,
      longitude: location.longitude,
      address: location.address,
      displayName: location.geocodedAddress,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
