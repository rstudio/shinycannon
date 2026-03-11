import asyncio

import numpy as np
import plotly.graph_objects as go
from shiny import App, reactive, render, ui
from shiny.ui import HTML, tags
from shinywidgets import output_widget, render_plotly

# -- Fake product catalog "database" ----------------------------------------
catalog = {
    "Electronics": ["Laptop", "Headphones", "Smartwatch", "Tablet", "Camera"],
    "Clothing": ["Jacket", "Sneakers", "T-Shirt", "Jeans", "Hat"],
    "Home": ["Blender", "Lamp", "Pillow", "Rug", "Candle"],
    "Sports": ["Basketball", "Yoga Mat", "Tennis Racket", "Helmet", "Dumbbells"],
}

simulation_sizes = {"Low": 5_000, "Medium": 25_000, "High": 100_000}

app_ui = ui.page_sidebar(
    ui.sidebar(
        ui.input_select("category", "Product Category:", choices=list(catalog.keys())),
        ui.input_select("product", "Product:", choices=[]),
        tags.div(
            tags.span(
                class_="spinner-border spinner-border-sm me-1",
                role="status",
                **{"aria-hidden": "true"},
            ),
            "Updating product list...",
            id="product-status",
            style="margin-top: -0.5rem; margin-bottom: 0.5rem; font-size: 0.85em; color: #6c757d; display: none;",
        ),
        tags.script(
            HTML("""
            Shiny.addCustomMessageHandler('product-loading', (loading) => {
                const container = document.getElementById('product').closest('.shiny-input-container');
                const status = document.getElementById('product-status');
                if (loading) {
                    container.style.opacity = '0.5';
                    container.style.pointerEvents = 'none';
                    container.setAttribute('aria-busy', 'true');
                    status.style.display = 'block';
                } else {
                    container.style.opacity = '';
                    container.style.pointerEvents = '';
                    container.removeAttribute('aria-busy');
                    status.style.display = 'none';
                }
            });
            """)
        ),
        ui.input_radio_buttons(
            "sim_size",
            "Simulation Detail:",
            choices=list(simulation_sizes.keys()),
            selected="Medium",
            inline=True,
        ),
        ui.input_task_button("run", "Run Forecast"),
        open={"desktop": "open", "mobile": "always-above"},
    ),
    ui.busy_indicators.use(),
    ui.card(
        ui.card_header("Demand Simulation"),
        output_widget("sim_plot"),
        min_height="300px",
    ),
    ui.card(
        ui.card_header("Forecast Summary"),
        ui.output_text_verbatim("result_text"),
        min_height="300px",
    ),
    title="Demand Forecast Demo",
    class_="bslib-page-dashboard",
    fillable=True
)


def server(input, output, session):
    # Step 1 -> Step 2: selecting a category triggers a slow "DB read"
    # to fetch the products in that category
    @reactive.effect
    @reactive.event(input.category)
    async def _update_products():
        await session.send_custom_message("product-loading", True)
        await asyncio.sleep(1.5)
        ui.update_select("product", choices=catalog[input.category()])
        await session.send_custom_message("product-loading", False)

    # Step 3 -> Step 4: run forecast on button click
    @reactive.calc
    @reactive.event(input.run)
    async def result():
        product = input.product()
        n = simulation_sizes[input.sim_size()]

        # Fake slow database read for historical sales data
        await asyncio.sleep(2)

        # Monte Carlo demand simulation
        seed = sum(ord(c) for c in product)
        rng = np.random.default_rng(seed)
        base_demand = 50 + (seed % 150)
        daily_demand = rng.poisson(lam=base_demand, size=n)

        return {
            "product": product,
            "category": input.category(),
            "n": n,
            "demand": daily_demand,
            "base_demand": base_demand,
        }

    @render_plotly
    async def sim_plot():
        res = await result()

        fig = go.Figure()
        fig.add_trace(
            go.Histogram(
                x=res["demand"],
                nbinsx=40,
                marker=dict(color="#2171b5", line=dict(color="white", width=0.5)),
            )
        )
        fig.add_vline(
            x=res["base_demand"],
            line=dict(color="#cb181d", width=2, dash="dash"),
        )
        fig.add_annotation(
            x=res["base_demand"],
            y=1,
            yref="paper",
            text=f"Expected: {res['base_demand']} units",
            showarrow=False,
            yanchor="bottom",
            font=dict(color="#cb181d"),
        )
        fig.update_layout(
            title=f"Simulated Daily Demand: {res['product']}",
            xaxis_title="Units per Day",
            yaxis_title="Frequency",
        )

        return fig

    @render.text
    async def result_text():
        res = await result()
        q05, q50, q95 = np.quantile(res["demand"], [0.05, 0.5, 0.95])
        return (
            f"Product: {res['product']} ({res['category']})\n"
            f"Simulated days: {res['n']:,}\n"
            f"Expected demand: {res['base_demand']} units/day\n"
            f"\n"
            f" 5th percentile: {int(q05)} units\n"
            f"        Median: {int(q50)} units\n"
            f"95th percentile: {int(q95)} units"
        )


app = App(app_ui, server)
