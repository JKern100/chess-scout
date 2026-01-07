/**
 * Quick fix script for bazeenga2 import
 * Run with: node scripts/fix-bazeenga2.mjs
 */

const BASE_URL = "http://localhost:3002";

async function fixImport() {
  console.log("Fixing bazeenga2 import...");
  
  try {
    const res = await fetch(`${BASE_URL}/api/imports/fix-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bazeenga2" }),
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error("Error:", data.error || res.statusText);
      process.exit(1);
    }
    
    console.log("✓ Import fixed:", data.message);
    console.log("✓ Indexing should start automatically");
    console.log("\nRefresh your browser to see the updated status.");
  } catch (err) {
    console.error("Failed to fix import:", err.message);
    process.exit(1);
  }
}

fixImport();
