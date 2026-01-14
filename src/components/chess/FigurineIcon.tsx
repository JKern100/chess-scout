"use client";

type PieceType = "N" | "B" | "R" | "Q" | "K";
type PieceColor = "white" | "black";

type Props = {
  piece: PieceType;
  color: PieceColor;
  className?: string;
};

const PIECE_PATHS: Record<PieceType, React.ReactNode> = {
  N: (
    <>
      <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" strokeLinecap="round" />
      <path d="M24 18c.3 1.2 2 1.9 2 4.5 0 2-2 3.5-2 3.5" strokeLinecap="round" />
      <path d="M9.5 25.5A.5.5 0 1 1 9 25a.5.5 0 0 1 .5.5z" fill="currentColor" />
      <path d="M15 15.5c4.5 2.5 5 2 5 0 0-4-10-7-10-1s5.5 8.5 10 10.5" strokeLinecap="round" />
    </>
  ),
  B: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 36c3.39 7 24.28 7 27 0M15 32c2.5 2.5 12.5 2.5 15 0M17 26.5L15 32h15l-2-5.5M22.5 10s5 4 5 10-5 11-5 11-5-5-5-11 5-10 5-10" />
      <path d="M17.5 18h10M22.5 15v6" strokeWidth="1" />
    </g>
  ),
  R: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5M34 14l-3 3H14l-3-3M31 17v12.5H14V17M31 29.5l1.5 2.5h-20l1.5-2.5M11 14h23" />
    </g>
  ),
  Q: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-13.5V25l-7-11 2 12zM9 26c0 2 1.5 2 2.5 4 2.5 5 18.5 5 21 0 1-2 2.5-2 2.5-4-6.5-1.5-18.5-1.5-26 0zM11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" />
    </g>
  ),
  K: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.5 11.63V6M20 8h5M22.5 25s4.5-7.5 4.5-11.5c0-2-1-4-4.5-4s-4.5 2-4.5 4c0 4 4.5 11.5 4.5 11.5zM11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-1-1-4-1-4h-8.5s-2.5 8-5 8-5-8-5-8H10s3 3-1 4c-3 6 6 10.5 6 10.5v7zM11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" />
    </g>
  ),
};

export function FigurineIcon({ piece, color, className = "" }: Props) {
  // White pieces: black stroke, white fill
  // Black pieces: white stroke, black fill
  const stroke = color === "white" ? "#000" : "#fff";
  const fill = color === "white" ? "#fff" : "#000";

  return (
    <svg
      viewBox="0 0 45 45"
      className={`inline-block align-baseline ${className}`}
      style={{ width: "1.1em", height: "1.1em", verticalAlign: "text-bottom" }}
      fill={fill}
      stroke={stroke}
      strokeWidth="1.5"
    >
      {PIECE_PATHS[piece]}
    </svg>
  );
}

/**
 * Replaces piece letters (N, B, R, Q, K) in a SAN string with figurine icons.
 * Returns an array of React nodes.
 */
export function sanToFigurine(san: string, isWhiteMove: boolean): React.ReactNode {
  const pieceLetters = ["N", "B", "R", "Q", "K"] as const;
  const color: PieceColor = isWhiteMove ? "white" : "black";

  const unicodeByColor: Record<PieceColor, Record<PieceType, string>> = {
    white: {
      K: "♔",
      Q: "♕",
      R: "♖",
      B: "♗",
      N: "♘",
    },
    black: {
      K: "♚",
      Q: "♛",
      R: "♜",
      B: "♝",
      N: "♞",
    },
  };

  const pieceToUnicode = (p: PieceType) => unicodeByColor[color][p];

  // Check if the first character is a piece letter
  const firstChar = san.charAt(0);
  if (pieceLetters.includes(firstChar as PieceType)) {
    return (
      <span className="inline-flex items-baseline gap-0">
        <span>{pieceToUnicode(firstChar as PieceType)}</span>
        <span>{san.slice(1)}</span>
      </span>
    );
  }

  // Handle promotion (e.g., e8=Q)
  const promoMatch = san.match(/^(.+)=([NBRQK])(.*)$/);
  if (promoMatch) {
    const [, before, promoPiece, after] = promoMatch;
    return (
      <span className="inline-flex items-baseline gap-0">
        <span>{before}=</span>
        <span>{pieceToUnicode(promoPiece as PieceType)}</span>
        <span>{after}</span>
      </span>
    );
  }

  // No piece letter, return as-is (pawn moves, castling)
  return san;
}
