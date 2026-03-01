<?php
// backend/api/update_nest.php
require_once 'db.php';
require_once 'auth/auth_util.php';

$user_id = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id']) || !isset($data['lat']) || !isset($data['lng'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $stmt = $pdo->prepare("UPDATE taubennester SET lat = ?, lng = ? WHERE id = ?");
    $stmt->execute([$data['lat'], $data['lng'], $data['id']]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>