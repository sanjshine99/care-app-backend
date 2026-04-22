const { dateCoveredByAnyPeriod } = require("./serviceNotRequiredPeriodService");

describe("dateCoveredByAnyPeriod", () => {
  test("single UTC day inside range", () => {
    const periods = [
      {
        startDate: new Date(Date.UTC(2026, 5, 1)),
        endDate: new Date(Date.UTC(2026, 5, 3)),
      },
    ];
    expect(dateCoveredByAnyPeriod(periods, new Date(Date.UTC(2026, 5, 2)))).toBe(true);
    expect(dateCoveredByAnyPeriod(periods, new Date(Date.UTC(2026, 5, 4)))).toBe(false);
  });

  test("first and last inclusive day", () => {
    const periods = [
      {
        startDate: new Date(Date.UTC(2026, 5, 10)),
        endDate: new Date(Date.UTC(2026, 5, 12)),
      },
    ];
    expect(dateCoveredByAnyPeriod(periods, new Date(Date.UTC(2026, 5, 10)))).toBe(true);
    expect(dateCoveredByAnyPeriod(periods, new Date(Date.UTC(2026, 5, 12)))).toBe(true);
  });
});
