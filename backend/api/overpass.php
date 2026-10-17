<?php
// backend/api/overpass.php
// Server-side proxy for OpenStreetMap Overpass API queries.
// Resolves CORS issues, avoids browser rate-limiting / 406 WAF blocks,
// and handles automatic failover across official Overpass mirrors.

if (isset($_SERVER['HTTP_ORIGIN']) && strpos($_SERVER['HTTP_ORIGIN'], 'localhost') !== false) {
    header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
} else {
    header("Access-Control-Allow-Origin: *");
}
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

header('Content-Type: application/json');

// Retrieve Overpass QL query from POST or GET
$query = '';
if (!empty($_POST['data'])) {
    $query = $_POST['data'];
} elseif (!empty($_GET['data'])) {
    $query = $_GET['data'];
} else {
    $rawInput = file_get_contents('php://input');
    if (!empty($rawInput)) {
        $json = json_decode($rawInput, true);
        if (!empty($json['data'])) {
            $query = $json['data'];
        } elseif (!empty($json['query'])) {
            $query = $json['query'];
        } else {
            $query = $rawInput;
        }
    }
}

$query = trim($query);
if (empty($query)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing query parameter "data"']);
    exit;
}

// Simple server-side caching (15 minutes) based on query hash
$cacheDir = sys_get_temp_dir();
$cacheFile = $cacheDir . '/nester_overpass_' . md5($query) . '.json';
$cacheLifetime = 15 * 60; // 15 minutes

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheLifetime)) {
    $cachedContent = file_get_contents($cacheFile);
    if (!empty($cachedContent)) {
        header('X-Cache: HIT');
        echo $cachedContent;
        exit;
    }
}

$endpoints = [
    'https://overpass.osm.ch/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
];

$successResponse = null;

foreach ($endpoints as $endpoint) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $endpoint);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, 'data=' . urlencode($query));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    curl_setopt($ch, CURLOPT_USERAGENT, 'NesterApp/1.2 (https://nester.hamburgerstadttauben.de; info@hamburgerstadttauben.de)');
    curl_setopt($ch, CURLOPT_REFERER, 'https://nester.hamburgerstadttauben.de/');
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Accept: application/json'
    ]);

    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode === 200 && !empty($result)) {
        // Verify it is valid JSON
        $decoded = json_decode($result, true);
        if ($decoded !== null && isset($decoded['elements'])) {
            $successResponse = $result;
            // Write to cache
            @file_put_contents($cacheFile, $result);
            break;
        }
    }
}

if ($successResponse !== null) {
    header('X-Cache: MISS');
    echo $successResponse;
} else {
    http_response_code(502);
    echo json_encode([
        'error' => 'Overpass mirrors currently unreachable',
        'elements' => []
    ]);
}
?>
