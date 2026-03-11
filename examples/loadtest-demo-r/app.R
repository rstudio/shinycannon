library(shiny)
library(bslib)
library(plotly)

# -- Fake product catalog "database" ----------------------------------------
catalog <- list(
  Electronics = c("Laptop", "Headphones", "Smartwatch", "Tablet", "Camera"),
  Clothing = c("Jacket", "Sneakers", "T-Shirt", "Jeans", "Hat"),
  Home = c("Blender", "Lamp", "Pillow", "Rug", "Candle"),
  Sports = c("Basketball", "Yoga Mat", "Tennis Racket", "Helmet", "Dumbbells")
)

simulation_sizes <- c(Low = 5000, Medium = 25000, High = 100000)

ui <- page_sidebar(
  title = "Demand Forecast Demo",
  sidebar = sidebar(
    open = list(desktop = "open", mobile = "always-above"),
    selectInput("category", "Product Category:", choices = names(catalog)),
    selectInput("product", "Product:", choices = NULL),
    tags$div(
      id = "product-status",
      style = "margin-top: -0.5rem; margin-bottom: 0.5rem; font-size: 0.85em; color: #6c757d; display: none;",
      tags$span(
        class = "spinner-border spinner-border-sm me-1",
        role = "status",
        `aria-hidden` = "true"
      ),
      "Updating product list..."
    ),
    tags$script(HTML("
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
    ")),
    radioButtons(
      "sim_size",
      "Simulation Detail:",
      choices = names(simulation_sizes),
      selected = "Medium",
      inline = TRUE
    ),
    input_task_button("run", "Run Forecast")
  ),
  class = "bslib-page-dasboard",
  shiny::useBusyIndicators(),
  card(
    min_height = 300,
    card_header("Demand Simulation"),
    plotlyOutput("sim_plot")
  ),
  card(
    min_height = 300,
    card_header("Forecast Summary"),
    verbatimTextOutput("result_text")
  )
)

server <- function(input, output, session) {
  # Step 1 -> Step 2: selecting a category triggers a slow "DB read"
  # to fetch the products in that category
  observeEvent(input$category, {
    session$sendCustomMessage("product-loading", TRUE)
    Sys.sleep(1.5)
    updateSelectInput(
      session,
      "product",
      choices = catalog[[input$category]]
    )
    session$sendCustomMessage("product-loading", FALSE)
  })

  # Step 3 -> Step 4: run forecast on button click
  result <- eventReactive(input$run, {
    product <- input$product
    n <- simulation_sizes[[input$sim_size]]

    # Fake slow database read for historical sales data
    Sys.sleep(2)

    # Monte Carlo demand simulation
    # Generate daily demand samples from a shifted distribution per product
    seed <- sum(utf8ToInt(product))
    set.seed(seed)
    base_demand <- 50 + (seed %% 150)
    daily_demand <- rpois(n, lambda = base_demand)

    list(
      product = product,
      category = input$category,
      n = n,
      demand = daily_demand,
      base_demand = base_demand
    )
  })

  output$sim_plot <- renderPlotly({
    res <- result()

    plot_ly(
      x = res$demand,
      type = "histogram",
      nbinsx = 40,
      marker = list(color = "#2171b5", line = list(color = "white", width = 0.5))
    ) |>
      layout(
        title = sprintf("Simulated Daily Demand: %s", res$product),
        xaxis = list(title = "Units per Day"),
        yaxis = list(title = "Frequency"),
        shapes = list(
          list(
            type = "line",
            x0 = res$base_demand, x1 = res$base_demand,
            y0 = 0, y1 = 1, yref = "paper",
            line = list(color = "#cb181d", width = 2, dash = "dash")
          )
        ),
        annotations = list(
          list(
            x = res$base_demand, y = 1, yref = "paper",
            text = sprintf("Expected: %d units", res$base_demand),
            showarrow = FALSE, yanchor = "bottom",
            font = list(color = "#cb181d")
          )
        )
      ) |>
      config(displayModeBar = FALSE)
  })

  output$result_text <- renderText({
    res <- result()
    q <- quantile(res$demand, probs = c(0.05, 0.5, 0.95))
    sprintf(
      paste0(
        "Product: %s (%s)\n",
        "Simulated days: %s\n",
        "Expected demand: %d units/day\n",
        "\n",
        " 5th percentile: %d units\n",
        "        Median: %d units\n",
        "95th percentile: %d units"
      ),
      res$product,
      res$category,
      format(res$n, big.mark = ","),
      res$base_demand,
      q[[1]],
      q[[2]],
      q[[3]]
    )
  })
}

shinyApp(ui, server)
