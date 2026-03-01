<?php
// backend/api/delete_nest.php
require_once 'db.php';
require_once 'auth/auth_util.php';

$user_id = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing id']);
    exit;
}

try {
    // Fetch current photo to delete it if exists
    $stmt = $pdo->prepare("SELECT photo_filename FROM taubennester WHERE id = ?");
    $stmt->execute([$data['id']]);
    $nest = $stmt->fetch();

    if ($nest && $nest['photo_filename']) {
        $uploadDir = __DIR__ . '/../uploads/nests/';
        $oldFilePath = $uploadDir . $nest['photo_filename'];
        if (file_exists($oldFilePath)) {
            unlink($oldFilePath);
        }
    }

    // Foreign key constraint (ON DELETE CASCADE) deletes logs automatically
    $stmt = $pdo->prepare("DELETE FROM taubennester WHERE id = ?");
    $stmt->execute([$data['id']]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>