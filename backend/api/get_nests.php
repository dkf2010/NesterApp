<?php
// backend/api/get_nests.php
require_once 'db.php';

try {
    // Get all nests
    $stmt = $pdo->query("SELECT * FROM taubennester ORDER BY created_at DESC");
    $nests = $stmt->fetchAll();

    // Attach logs to each nest
    foreach ($nests as &$nest) {
        $logQuery = "
            SELECT l.id, l.action, l.timestamp, u.username as user_name 
            FROM taubennest_logs l
            LEFT JOIN users u ON l.user_id = u.id
            WHERE l.nest_id = ? 
            ORDER BY l.timestamp DESC
        ";
        $logStmt = $pdo->prepare($logQuery);
        $logStmt->execute([$nest['id']]);
        $nest['logs'] = $logStmt->fetchAll();

        // Ensure JavaScript compatibility by renaming fields
        // Since JS expects camelCase for createdAt from previous state (though we adapt frontend next anyway)
        // Ensure lat/lng are cast to numbers from decimal strings
        $nest['lat'] = (float) $nest['lat'];
        $nest['lng'] = (float) $nest['lng'];
        $nest['createdAt'] = $nest['created_at'];
    }

    echo json_encode($nests);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>