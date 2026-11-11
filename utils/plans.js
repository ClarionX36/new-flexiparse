const planLimits = {
  free: { tables: 1, monthlyPages: 5, queueMinutes: 5 },
  starter: { tables: 5, monthlyPages: 300, queueMinutes: 3 },
  pro: { tables: 25, monthlyPages: 1000, queueMinutes: 0 },
  scale: { tables: Infinity, monthlyPages: 3500, queueMinutes: 0 }
};

module.exports = { planLimits };
