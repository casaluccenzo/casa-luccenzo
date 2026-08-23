// CSV Export Module for Casa Lucenzo Admin Panel

function exportSalesToCSV(salesLog = []) {
    if (!salesLog || salesLog.length === 0) {
        if (window.UIManager) window.UIManager.showToast("⚠️ No hay ventas registradas para exportar.", "fa-solid fa-file-excel");
        return;
    }

    const headers = ["Fecha", "Hora", "Producto", "Precio USD", "Precio Bs", "Costo Bs", "Margen Bs", "Metodo Pago", "UUID"];
    const rows = salesLog.map(s => {
        const dateObj = new Date(s.timestamp || Date.now());
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString();
        const bcvRate = s.bcv_rate || s.bcvRate || window.bcvRate || 744.23;
        const priceBs = (s.price || 0) * bcvRate;
        const costBs = s.cost_at_sale || 0;
        const marginBs = priceBs - costBs;
        return [
            `"${dateStr}"`,
            `"${timeStr}"`,
            `"${(s.name || '').replace(/"/g, '""')}"`,
            s.price ? s.price.toFixed(2) : "0.00",
            priceBs.toFixed(2),
            costBs.toFixed(2),
            marginBs.toFixed(2),
            `"${s.paymentMethod || 'Efectivo USD'}"`,
            `"${s.uuid || ''}"`
        ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `Casa_Lucenzo_Ventas_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.UIManager) window.UIManager.showToast("📥 Reporte CSV de Ventas descargado.", "fa-solid fa-file-csv");
}

function exportExpensesToCSV(expenses = []) {
    if (!expenses || expenses.length === 0) {
        if (window.UIManager) window.UIManager.showToast("⚠️ No hay gastos registrados para exportar.", "fa-solid fa-file-excel");
        return;
    }

    const headers = ["Fecha", "Hora", "Descripcion", "Monto USD", "Monto Bs", "Categoria", "UUID"];
    const rows = expenses.map(e => {
        const dateObj = new Date(e.timestamp || Date.now());
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString();
        const bcvRate = window.bcvRate || 744.23;
        const amountBs = ((e.amount || 0) * bcvRate).toFixed(2);
        return [
            `"${dateStr}"`,
            `"${timeStr}"`,
            `"${(e.description || '').replace(/"/g, '""')}"`,
            e.amount ? e.amount.toFixed(2) : "0.00",
            amountBs,
            `"${e.category || 'General'}"`,
            `"${e.uuid || ''}"`
        ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `Casa_Lucenzo_Gastos_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.UIManager) window.UIManager.showToast("📥 Reporte CSV de Gastos descargado.", "fa-solid fa-file-csv");
}

window.exportSalesToCSV = exportSalesToCSV;
window.exportExpensesToCSV = exportExpensesToCSV;
