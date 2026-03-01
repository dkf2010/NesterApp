import { Plus, X } from 'lucide-react';
import './AddNestButton.css';

export default function AddNestButton({ onClick, isAdding, isMoving }) {
    const activeClass = (isAdding || isMoving) ? 'active' : '';
    let text = "Neues Nest";
    if (isAdding) text = "Tippe auf Karte";
    if (isMoving) text = "Neue Position antippen";

    return (
        <button
            className={`fab glass ${activeClass}`}
            onClick={onClick}
            aria-label={text}
        >
            {(!isAdding && !isMoving) && <Plus size={28} className="fab-icon" />}
            {(isAdding || isMoving) && <X size={28} className="fab-icon" />}
            <span className="fab-text">
                {text}
            </span>
        </button>
    );
}
