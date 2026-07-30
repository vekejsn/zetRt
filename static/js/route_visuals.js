function getRouteVisual(routeShortName, routeType, realTime = true) {
  if (Number(routeType) === 3) {
    if (!realTime) return { color: '#727272', textColor: '#ffffff' };

    const routeNumber = /^\d+$/.test(String(routeShortName)) ? Number(routeShortName) : null;
    if (routeNumber >= 100 && routeNumber < 200) return { color: '#126400', textColor: '#ffffff' };
    if (routeNumber >= 200 && routeNumber < 300) return { color: '#C66A00', textColor: '#ffffff' };
    if (routeNumber >= 300 && routeNumber < 400) return { color: '#7A3E9D', textColor: '#ffffff' };
    return { color: '#126400', textColor: '#ffffff' };
  }

  if (Number(routeType) === 0) return { color: realTime ? '#1264AB' : '#535353', textColor: '#ffffff' };
  return { color: '#121212', textColor: '#ffffff' };
}
