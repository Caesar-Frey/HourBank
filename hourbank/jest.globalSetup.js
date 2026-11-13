/**
 * Pin the test time zone. Date bucketing (local months, weeks, "today") is
 * tested against South African time, where the app is used; without this the
 * suite only passes on machines set to Africa/Johannesburg.
 */
module.exports = async () => {
  process.env.TZ = 'Africa/Johannesburg';
};
