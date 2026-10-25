<?php
// backend/api/indoor.php
// Dedicated High-Performance Endpoint for OSM Indoor & Parking Deck Features.
// Features:
// 1. Instant local serving from backend/data/indoor_hamburg.geojson (~5ms)
// 2. Spatial bounding-box filtering with precalculated bounding boxes
// 3. Grid-snapped server-side file caching (30 days TTL) for areas outside Hamburg
// 4. Automatic failover to diverse Overpass mirrors (FR, DE, LZ4, Z)
// 5. Gzip compression, ETag / 304 Not Modified caching, and CLI refresh support

if (isset($_SERVER['HTTP_ORIGIN']) && strpos($_SERVER['HTTP_ORIGIN'], 'localhost') !== false) {
    header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
} else {
    header("Access-Control-Allow-Origin: *");
}
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Expose-Headers: ETag, Content-Length, X-Source, X-Indoor-Version");

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Enable gzip compression if possible
if (!in_array('ob_gzhandler', ob_list_handlers()) && extension_loaded('zlib') && !headers_sent()) {
    @ob_start('ob_gzhandler');
}

require_once dirname(__DIR__) . '/config.php';

$hamburgDataDir = dirname(__DIR__) . '/data';
if (!is_dir($hamburgDataDir)) {
    @mkdir($hamburgDataDir, 0755, true);
}
$hamburgDataFile = $hamburgDataDir . '/indoor_hamburg.geojson';
$cacheDir = __DIR__ . '/../cache/indoor';
if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0755, true);
}
if (!is_dir($cacheDir) || !is_writable($cacheDir)) {
    $cacheDir = sys_get_temp_dir() . '/nester_indoor_cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }
}

/**
 * Convert Overpass OSM elements to GeoJSON FeatureCollection.
 */
function osmElementsToGeoJson($elements) {
    $features = [];
    foreach ($elements as $el) {
        if (empty($el['tags'])) continue;
        $level = isset($el['tags']['level']) ? (string)$el['tags']['level'] : '0';
        $properties = array_merge(['id' => $el['id'], 'level' => $level], $el['tags']);

        if ($el['type'] === 'node' && isset($el['lat'], $el['lon'])) {
            $lon = round((float)$el['lon'], 6);
            $lat = round((float)$el['lat'], 6);
            $features[] = [
                'type' => 'Feature',
                'properties' => $properties,
                'geometry' => [
                    'type' => 'Point',
                    'coordinates' => [$lon, $lat]
                ],
                'bbox' => [$lon, $lat, $lon, $lat]
            ];
        } elseif ($el['type'] === 'way' && !empty($el['geometry']) && count($el['geometry']) > 1) {
            $coords = [];
            $minLon = 180.0; $minLat = 90.0; $maxLon = -180.0; $maxLat = -90.0;
            foreach ($el['geometry'] as $pt) {
                $lon = round((float)$pt['lon'], 6);
                $lat = round((float)$pt['lat'], 6);
                $coords[] = [$lon, $lat];
                if ($lon < $minLon) $minLon = $lon;
                if ($maxLon < $lon) $maxLon = $lon;
                if ($lat < $minLat) $minLat = $lat;
                if ($maxLat < $lat) $maxLat = $lat;
            }
            $first = $coords[0];
            $last = $coords[count($coords) - 1];
            $isClosed = (count($coords) > 3 && $first[0] === $last[0] && $first[1] === $last[1]);

            $isRoom = !empty($el['tags']['indoor']) && ($el['tags']['indoor'] === 'room' || $el['tags']['indoor'] === 'area');
            $isParking = (!empty($el['tags']['amenity']) && $el['tags']['amenity'] === 'parking_space') || !empty($el['tags']['parking']);

            if ($isClosed || $isRoom || $isParking) {
                $ring = $isClosed ? $coords : array_merge($coords, [$coords[0]]);
                $features[] = [
                    'type' => 'Feature',
                    'properties' => $properties,
                    'geometry' => [
                        'type' => 'Polygon',
                        'coordinates' => [$ring]
                    ],
                    'bbox' => [$minLon, $minLat, $maxLon, $maxLat]
                ];
            } else {
                $features[] = [
                    'type' => 'Feature',
                    'properties' => $properties,
                    'geometry' => [
                        'type' => 'LineString',
                        'coordinates' => $coords
                    ],
                    'bbox' => [$minLon, $minLat, $maxLon, $maxLat]
                ];
            }
        }
    }
    return [
        'type' => 'FeatureCollection',
        'features' => $features
    ];
}

/**
 * Fetch raw OSM elements from Overpass mirrors with automatic failover.
 */
function fetchOverpassElements($query, $timeout = 15) {
    $endpoints = [
        'https://overpass.openstreetmap.fr/api/interpreter',
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://z.overpass-api.de/api/interpreter'
    ];

    foreach ($endpoints as $endpoint) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $endpoint);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, 'data=' . urlencode($query));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 4);
        curl_setopt($ch, CURLOPT_USERAGENT, 'NesterApp/1.2 (https://nester.hamburgerstadttauben.de; info@hamburgerstadttauben.de)');
        curl_setopt($ch, CURLOPT_REFERER, 'https://nester.hamburgerstadttauben.de/');
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if ($httpCode === 200 && !empty($result)) {
            $decoded = json_decode($result, true);
            if ($decoded !== null && isset($decoded['elements'])) {
                return $decoded['elements'];
            }
        }
    }
    return null;
}

// -----------------------------------------------------------------------------
// CLI / Admin Seed & Refresh Mode
// -----------------------------------------------------------------------------
$isCli = (php_sapi_name() === 'cli');
$cliArg = ($isCli && isset($argv[1])) ? $argv[1] : '';
$action = $_GET['action'] ?? ($cliArg ?: '');

if (($isCli && in_array($cliArg, ['--seed-hamburg', '--refresh', 'seed', 'refresh'])) || $action === 'refresh_hamburg') {
    $expectedToken = get_config('INDOOR_REFRESH_TOKEN', 'nester_secret_indoor_seed');
    if (!$isCli && (empty($_GET['token']) || empty($expectedToken) || !hash_equals((string)$expectedToken, (string)$_GET['token']))) {
        // Simple security check for web refresh
        http_response_code(403);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }

    $hamburgQuery = '[out:json][timeout:60];(way["indoor"](53.40,9.80,53.70,10.25);way["amenity"="parking_space"](53.40,9.80,53.70,10.25);node["indoor"](53.40,9.80,53.70,10.25);node["highway"="elevator"](53.40,9.80,53.70,10.25);node["highway"="steps"](53.40,9.80,53.70,10.25););out geom;';
    $elements = fetchOverpassElements($hamburgQuery, 45);

    if ($elements !== null) {
        $geoJson = osmElementsToGeoJson($elements);
        $geoJson['generated_at'] = date('c');
        $geoJson['area'] = 'Hamburg';
        @file_put_contents($hamburgDataFile, json_encode($geoJson));
        echo json_encode([
            'success' => true,
            'features' => count($geoJson['features']),
            'message' => 'Hamburg indoor data successfully updated'
        ]);
        exit;
    } else {
        http_response_code(502);
        echo json_encode(['error' => 'Failed to query Overpass mirrors for Hamburg seed']);
        exit;
    }
}

// -----------------------------------------------------------------------------
// Serve Version / Metadata of Hamburg Indoor Dataset
// -----------------------------------------------------------------------------
if ($action === 'version') {
    header('Content-Type: application/json');
    if (file_exists($hamburgDataFile)) {
        $mtime = filemtime($hamburgDataFile);
        $etag = md5_file($hamburgDataFile);
        $generatedAt = null;

        $fp = @fopen($hamburgDataFile, 'r');
        if ($fp) {
            @fseek($fp, -2048, SEEK_END);
            $tail = @fread($fp, 2048);
            @fclose($fp);
            if (preg_match('/"generated_at"\s*:\s*"([^"]+)"/', $tail, $matches)) {
                $generatedAt = $matches[1];
            }
        }

        echo json_encode([
            'version' => $generatedAt ?: $etag,
            'generated_at' => $generatedAt,
            'etag' => $etag,
            'mtime' => $mtime
        ]);
        exit;
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'Indoor data file not found']);
        exit;
    }
}

// -----------------------------------------------------------------------------
// Serve Whole Hamburg Dataset (for pre-caching in PWA / offline mode)
// -----------------------------------------------------------------------------
if ($action === 'hamburg') {
    if (file_exists($hamburgDataFile)) {
        $etag = '"' . md5_file($hamburgDataFile) . '"';
        header('ETag: ' . $etag);
        header('X-Indoor-Version: ' . trim($etag, '"'));
        header('Cache-Control: public, max-age=604800'); // 7 days

        if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
            http_response_code(304);
            exit;
        }

        readfile($hamburgDataFile);
        exit;
    }
}

// -----------------------------------------------------------------------------
// Spatial Bounding Box Query: ?bbox=south,west,north,east
// -----------------------------------------------------------------------------
$bbox = $_GET['bbox'] ?? '';
if (empty($bbox)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing parameter "bbox" (format: south,west,north,east)']);
    exit;
}

$parts = explode(',', $bbox);
if (count($parts) !== 4) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid bbox format. Expected: south,west,north,east']);
    exit;
}

$s = (float)$parts[0];
$w = (float)$parts[1];
$n = (float)$parts[2];
$e = (float)$parts[3];

if ($s >= $n || $w >= $e) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid bbox bounds coordinates']);
    exit;
}

// 1. Check if bbox falls inside or intersects Hamburg metropolitan dataset
// Hamburg roughly: lat 53.38 to 53.75, lon 9.70 to 10.32
$isWithinHamburg = ($s >= 53.35 && $n <= 53.75 && $w >= 9.65 && $e <= 10.35);

if ($isWithinHamburg && file_exists($hamburgDataFile)) {
    $hamburgRaw = @file_get_contents($hamburgDataFile);
    $hamburgData = json_decode($hamburgRaw, true);

    if ($hamburgData && isset($hamburgData['features'])) {
        $matchedFeatures = [];
        // Add a small 0.0005 buffer to prevent edge-clipping
        $pad = 0.0005;
        $bs = $s - $pad;
        $bw = $w - $pad;
        $bn = $n + $pad;
        $be = $e + $pad;

        foreach ($hamburgData['features'] as $f) {
            if (isset($f['bbox'])) {
                $fb = $f['bbox']; // [minLon, minLat, maxLon, maxLat]
                if (!($fb[1] > $bn || $fb[3] < $bs || $fb[0] > $be || $fb[2] < $bw)) {
                    $matchedFeatures[] = $f;
                }
            }
        }

        header('X-Source: Pre-cached Hamburg Dataset');
        header('Cache-Control: public, max-age=86400'); // 1 day
        echo json_encode([
            'type' => 'FeatureCollection',
            'features' => $matchedFeatures
        ]);
        exit;
    }
}

// 2. Query areas outside Hamburg with Grid-Snapped Server Cache (30 days)
$gridSnap = 0.005;
$gridS = floor($s / $gridSnap) * $gridSnap;
$gridW = floor($w / $gridSnap) * $gridSnap;
$gridN = ceil($n / $gridSnap) * $gridSnap;
$gridE = ceil($e / $gridSnap) * $gridSnap;

$cacheKey = sprintf('indoor_%.3f_%.3f_%.3f_%.3f', $gridS, $gridW, $gridN, $gridE);
$cacheFile = $cacheDir . '/' . md5($cacheKey) . '.json';
$cacheLifetime = 30 * 86400; // 30 days

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheLifetime)) {
    $cached = @file_get_contents($cacheFile);
    if (!empty($cached)) {
        header('X-Source: Server Grid Cache');
        header('Cache-Control: public, max-age=86400');
        echo $cached;
        exit;
    }
}

// 3. Fallback to Overpass query for the requested grid
$query = sprintf('
    [out:json][timeout:15];
    (
        way["indoor"](%.4f,%.4f,%.4f,%.4f);
        way["amenity"="parking_space"](%.4f,%.4f,%.4f,%.4f);
        way["parking"](%.4f,%.4f,%.4f,%.4f);
        node["indoor"](%.4f,%.4f,%.4f,%.4f);
        node["highway"="elevator"](%.4f,%.4f,%.4f,%.4f);
        node["highway"="steps"](%.4f,%.4f,%.4f,%.4f);
    );
    out geom;
', $gridS, $gridW, $gridN, $gridE, $gridS, $gridW, $gridN, $gridE, $gridS, $gridW, $gridN, $gridE, $gridS, $gridW, $gridN, $gridE, $gridS, $gridW, $gridN, $gridE, $gridS, $gridW, $gridN, $gridE);

$elements = fetchOverpassElements($query, 15);

if ($elements !== null) {
    $geoJson = osmElementsToGeoJson($elements);
    $encoded = json_encode($geoJson);
    @file_put_contents($cacheFile, $encoded);

    header('X-Source: Overpass Live (Cached)');
    header('Cache-Control: public, max-age=86400');
    echo $encoded;
} else {
    // Return empty collection gracefully instead of 500
    http_response_code(200);
    echo json_encode([
        'type' => 'FeatureCollection',
        'features' => [],
        'warning' => 'Overpass mirrors currently unreachable'
    ]);
}
