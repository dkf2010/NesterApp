<?php
// backend/api/delete_nest.php
require_once 'db.php';
require_once 'auth/auth_util.php';
require_once 'app_logger.php';

$currentUser = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing id']);
    exit;
}

try {
    // Fetch current photo to delete it if exists
    $stmt = $pdo->prepare("SELECT name, photo_filename FROM taubennester WHERE id = ?");
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

    app_log($pdo, 'info', 'api/delete_nest', "Nest gelöscht: " . ($nest['name'] ?? $data['id']), [
        'nest_id' => $data['id'],
        'had_photo' => !empty($nest['photo_filename'])
    ], $currentUser['id']);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    app_log($pdo, 'error', 'api/delete_nest', 'Fehler beim Löschen eines Nests', [
        'exception' => $e->getMessage(),
        'nest_id' => $data['id'] ?? null
    ], $currentUser['id']);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>