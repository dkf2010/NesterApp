<?php
// backend/api/update_nest.php
require_once 'db.php';
require_once 'auth/auth_util.php';
require_once 'app_logger.php';

$currentUser = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id']) || !isset($data['lat']) || !isset($data['lng'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $stmt = $pdo->prepare("UPDATE taubennester SET lat = ?, lng = ? WHERE id = ?");
    $stmt->execute([$data['lat'], $data['lng'], $data['id']]);

    app_log($pdo, 'info', 'api/update_nest', 'Nest-Standort verschoben', [
        'nest_id' => $data['id'],
        'lat' => $data['lat'],
        'lng' => $data['lng']
    ], $currentUser['id']);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    app_log($pdo, 'error', 'api/update_nest', 'Fehler beim Verschieben des Nests', [
        'exception' => $e->getMessage(),
        'nest_id' => $data['id'] ?? null
    ], $currentUser['id']);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>