/*global $, d3, window */

$(function() {

   var dragging = false;
   var width = $(window).width();
   var height = $(window).height() - $("#site-header").outerHeight(true) - 10;
   var tipShowTimer = -1;
   var tipX;
   var tipY;
   var data;
   var transX = 1;
   var transY = 1;
   var scale = 1;
   var vis;
   var lastId = 0;
   var pzRect;
   var zoom;
   var filter = {
       searchQuery: "",
       date: ""
   };
   var dragMenu = {
       x: 0,
       y: 0,
       dragging: false
   };

   function nodeSize(d) {
      if (d.type == "root") {
         d3.select(this).classed("root", true);
         return 30;
      }
      if (d.children && d.children.length > 0) {
         return 15;
      }
      var sz = ""+d.size;
      var extra = parseInt(sz.charAt(0),10);
      return sz.length*9+extra;
   }

   var hideMenu = function() {
      var d = $("#menu").data("target");
      if ( d ) {
         d3.select("#circle-" + d.id).classed("menu", false);
      }
      $("#menu").hide();
   };

   $(".titlebar").mousedown(function(e) {
      if (!dragMenu.dragging) {
         dragMenu.x = e.pageX;
         dragMenu.y = e.pageY;
         dragMenu.dragging = true;
      }
      return false;
   });

   $(window).mouseup(function(e) {
      if ( dragMenu.dragging ) {
         dragMenu.dragging = false;
         e.stopPropagation();
      }
   });

   $(window).mousemove(function(e) {
      if (dragMenu.dragging) {
         var dX = e.pageX - dragMenu.x;
         var dY = e.pageY - dragMenu.y;
         var off = $("#menu").offset();

         $("#menu").offset({
            left : (off.left + dX),
            top : (off.top + dY)
         });

         dragMenu.x = e.pageX;
         dragMenu.y = e.pageY;
      }
   });


   /**
    * REMOVE details for a previsously expaned facet
    */
   var clearFacets = function(d) {
      d.children = [];
      d.choice = null;
      d.other_facets = null;
      updateVisualization();
      var node = d3.select("#circle-"+d.id);
      node.classed("leaf", true);
      node.classed("parent", false);
      var sz = nodeSize(d);
      node.attr("r",  sz);
   };

   /**
    * get details for a facet on the specified node
    */
   var getFacetDetail = function(d, facetName) {
      showWaitPopup();

      // if facets have already been expanded for this node, remove them
	   var childrenReset = false;
	   if ( d.choice ) {
         d.children = [];
         d.choice = null;
         d.other_facets = null;
         childrenReset = true;
      }

      // determine the handle of the archive. it may be this node or a parent
      // when an archive has one of its facets expanded, those new nodes will
      // not have a handle; instead they have archive_handle which refers to the
      // parent archive
      var handle = d.handle;
      if ( !handle && d.archive_handle ) {
         handle = d.archive_handle;
      }

      // build the query string
      var query = "/facet?a="+handle+"&f="+facetName;
      var params = "";
      var paramsArray = [];
      if ( d.facet === "genre" ) {
          paramsArray.push("g=%2B"+d.name);
      }
      if ( d.facet === "discipline" ) {
          paramsArray.push("d=%2B"+d.name);
      }
      if ( d.facet === "doc_type" ) {
          paramsArray.push("t=%2B"+d.name);
      }
      if (d.other_facets) {
         if ( d.other_facets.g ) {
            var genre = d.other_facets.g.replace(/\+/g, "");
            paramsArray.push("g=%2B"+genre);
         }
         if ( d.other_facets.discipline ) {
            var discipline = d.other_facets.discipline.replace(/\+/g, "");
            paramsArray.push("d=%2B"+discipline);
         }
         if ( d.other_facets.doc_type ) {
            var doc_type = d.other_facets.doc_type.replace(/\+/g, "");
            paramsArray.push("t=%2B"+doc_type);
         }
      }
      params = paramsArray.join("&");
      if (params.length > 0 ) {
         params = "&"+params;
         params = params.replace(/\s/g, "+");
      }

      // append the query/date stuff
      params = params + getSearchParams("&");

      var node = d3.select("#circle-"+d.id);
      d3.json(query+params, function(json) {
         if ( json !== null && json.length > 0 ) {
            d.choice = facetName;
            node.classed("leaf", false);
            node.classed("parent", true);
            d.children = json;
            node.attr("r", "15");
            updateVisualization();
         } else {
            if ( childrenReset === true ) {
               updateVisualization();
            }
            node.classed("leaf", true);
            node.classed("parent", false);
            if ( facetName === "doc_type") {
               facetName = "format";
            }
            alert("No results found for facet '"+facetName+"'");
         }
         hideWaitPopup();
      });
   };

   function stripZeroLen(node) {
      node.size = parseInt(node.size, 10);
      if (node.size === 0) {
         return true;
      }
      if (node.children) {
         var idx;
         var child;
         var len = node.children.length;
         while (len--) {
            child = node.children[len];
            child.size = parseInt(child.size, 10);
            if (child.size === 0) {
               node.children.splice(len, 1);
            } else {
               if (stripZeroLen(child)) {
                  node.children.splice(len, 1);
               }
            }
         }
      }
      return false;
   }

   function getSearchParams( prepend ) {
      var params = [];
      if ( filter.searchQuery.length > 0 ) {
         params.push(filter.searchQuery);
      }
      if ( filter.date.length > 0 ) {
         params.push(filter.date);
      }
      var p = params.join("&");
      if ( p.length > 0 ) {
         return prepend+p;
      }
      return "";
   }

   /**
    * Filter the resuults with data range and/or search terms
    */
   var filterData = function() {
      // grab the search terms (if any) and get them formatted
      filter.searchQuery = $("#query").val();
      if ( filter.searchQuery.length > 0) {
         filter.searchQuery = "q=%2b"+filter.searchQuery.replace(/\s/g, "%2b");
      }

      // grab and format the date range (if any)
      var q = $("#from").val();
      var to = $("#to").val();
      if ( q.length > 0 ) {
         if ( q.length !== 4 ) {
            alert("Please enter a 4 digit year in the from field");
            return;
         }
         if ( to.length > 0 ) {
            if ( to.length !== 4 ) {
               alert("Please enter a 4 digit year in the to field");
               return;
            }
            q = q + "-"+to;
         }
      }
      if ( q.length > 0 ) {
         filter.date = "y=%2b"+q.replace(/-/,"+TO+");
      }

      if ( filter.date.length === 0 && filter.searchQuery === 0) {
         return;
      }


      // filter the results
      showWaitPopup();
      d3.json("/search"+getSearchParams("?"), function(json) {
         if ( !json ) {
            alert("Unable to perform date filter");
         } else {
            data = json;
            stripZeroLen(data);
            updateVisualization();
         }
         hideWaitPopup();
      });
   };
   $('.search input[type="text"]').keyup(function(e) {
      if (e.keyCode == 13) {
         filterData();
      }
   });
   $("#filter").on("click", function(e) {
      filterData();
   });

   /**
    * Reset center and scale of fisualizarion
    */
   var recenter = function() {
      zoom.scale(1);
      zoom.translate([0,0]);
      vis.attr("transform","translate(0,0) scale(1)");
      transX =0;
      transY = 0;
      scale = 1;
   };

   /**
    * Fully reset visualization
    */
   $("#reset").on("click", function() {
      filter.searchQuery = "";
      filter.date = "";
      showWaitPopup();
      hideMenu();
      $("#query").val("");
      data = null;
      recenter();
      d3.json("/archives", function(json) {
         data = json;
         updateVisualization();
         hideWaitPopup();
      });
   });
   $("#recenter").on("click", function() {
      hideMenu();
      recenter();
   });

   // Handlers for popup menu actions
   $("#menu img").on("click", function() {
      hideMenu();
   });
   $("#collapse").on("click", function() {
      var d = $("#menu").data("target");
      var node = d3.select("#circle-" + d.id);
      node.classed("collapsed", true);
      d.collapsedChildren = d.children;
      d.children = null;
      hideMenu();
      node.attr("r", nodeSize(d));
      updateVisualization();
   });
   $("#expand").on("click", function() {
      var d = $("#menu").data("target");
      var node = d3.select("#circle-" + d.id);
      node.attr("r", 15);
      node.classed("collapsed", false);
      d.children = d.collapsedChildren;
      d.collapsedChildren = null;
      updateVisualization();
      hideMenu();
   });
   $("#unpin").on("click", function() {
      var d = $("#menu").data("target");
      d.fixed = false;
      d3.select("#circle-" + d.id).classed("fixed", false);
      $("#unpin").hide();
      $("#pin").show();
   });
   $("#pin").on("click", function() {
      var d = $("#menu").data("target");
      d.fixed = true;
      d3.select("#circle-" + d.id).classed("fixed", true);
      $("#unpin").show();
      $("#pin").hide();
   });

   /**
    * Facet expansion
    */
   $("#genre").on("click", function() {
      var active =  $(this).find("input[type='checkbox']").prop('checked');
      $("#menu").find("input[type='checkbox']").prop('checked', false);
      var d = $("#menu").data("target");
      if (active === false) {
         d.fixed = true;
         d3.select("#circle-" + d.id).classed("fixed", true);
         getFacetDetail(d, "genre");
         $(this).find("input[type='checkbox']").prop('checked', true);
      } else {
         clearFacets(d);
         $(this).find("input[type='checkbox']").prop('checked', false);
      }
   });
   $("#discipline").on("click", function() {
      var active =  $(this).find("input[type='checkbox']").prop('checked');
      $("#menu").find("input[type='checkbox']").prop('checked', false);
      var d = $("#menu").data("target");
      if (active === false) {
         d.fixed = true;
         d3.select("#circle-" + d.id).classed("fixed", true);
         getFacetDetail(d, "discipline");
         $(this).find("input[type='checkbox']").prop('checked', true);
      } else {
         clearFacets(d);
         $(this).find("input[type='checkbox']").prop('checked', false);
      }
   });
   $("#doc_type").on("click", function() {
      var active =  $(this).find("input[type='checkbox']").prop('checked');
      $("#menu").find("input[type='checkbox']").prop('checked', false);
      var d = $("#menu").data("target");
      if (active === false) {
         d.fixed = true;
         d3.select("#circle-" + d.id).classed("fixed", true);
         getFacetDetail(d, "doc_type");
         $(this).find("input[type='checkbox']").prop('checked', true);
      } else {
         clearFacets(d);
         $(this).find("input[type='checkbox']").prop('checked', false);
      }
   });


   // Pan/Zoom behavior
   zoom = d3.behavior.zoom().on("zoom", function() {
      vis.attr("transform","translate(" + d3.event.translate + ")" + " scale(" + d3.event.scale + ")");
      transX = d3.event.translate[0];  // track the settings so the popup
      transY = d3.event.translate[1];  // menu and tooltip popups appear in
      scale = d3.event.scale;          // the correct place
   });

   // Initialize D3 visualization
   var force = d3.layout.force().size([width, height])
   	  .linkDistance(60)
   	  .charge(-800)
   	  .on("tick", tick);
   vis = d3.select("#main-content")
      .append("svg:svg")
         .attr("width", width)
         .attr("height", height)
      .append('svg:g').attr("id", "transform-group")
         .call(zoom)
      .append('svg:g');   // without this extra group, pan is jittery

   // add a fullscreen block as the background for the visualization
   // this catches mouse events that are not on the circles and lets the
   // whole thing be panned / zoomed
   pzRect = vis.append('svg:rect').attr('width', width).attr('height', height).attr('fill','#444444');

   // hide until data is received
   $("svg").hide();

   // Node drag behavior
   var drag = force.drag().on("dragstart", onDragStart);
   function onDragStart(d) {
      dragging = true;
      if (tipShowTimer !== -1) {
         clearTimeout(tipShowTimer);
         tipShowTimer = -1;
      }
      d3.select("#circle-"+d.id).classed("fixed", d.fixed = true);
      d3.event.sourceEvent.stopPropagation();
   }

   force.drag().on("dragend", function() {dragging = false;});

   // request the initial set of data; the archives
   d3.json("/archives", function(json) {
      data = json;
      updateVisualization();
   });

   /**
    * Redraw the d3 graph based on JSON data
    */
   var link = vis.selectAll(".link");    // all of the connecting lines
   var node = vis.selectAll(".node");    // all of the circles
   function updateVisualization() {

      var nodes = flatten(data);
      var links = d3.layout.tree().links(nodes);

      // Update the links
      link = link.data(links, function(d) {
         return d.target.id;
      });
      link.exit().remove();

      // Enter any new links
      link.enter().insert("line", ".node").attr("class", "link").attr("x1", function(d) {
         return d.source.x;
      }).attr("y1", function(d) {
         return d.source.y;
      }).attr("x2", function(d) {
         return d.target.x;
      }).attr("y2", function(d) {
         return d.target.y;
      });

      // Update the nodes
      node = node.data(nodes, function(d) {
         return d.id;
      });
      node.exit().remove();

      // Enter any new nodes; create a draggable group that will contain the circle and text
      var circles = node.enter()
         .append("svg:g")
            .attr("class", "node").call(drag);

      // add the circle to the group
      circles.append("svg:circle")
            .on("click", click)
            .on("mouseenter", onMouseOver)
            .on("mouseleave", onMouseLeave)
            .classed("fixed", isFixed)
            .classed("leaf", isLeaf)
            .classed("no-data", isNoData)
            .classed("parent", isParent)
            .attr("id", function(d) {
               return "circle-"+d.id;
            })
            .attr("r", nodeSize);

      // add the text to the group. NOTE: using classd stuff doesn't
      // work here for some reason. Have to directly apply style in.
      circles.append("svg:text")
            .text(function(d) {if (d.handle) return d.handle; else return d.name;})
            .attr("text-anchor", "middle")
            .style("pointer-events", "none")
            .style("font-size", "0.55em")
            .style("stroke-width", "0px")
            .style("fill", function(d) {
               if (isNoData(d) ) {
                  return "rgba(255,255,255,0.5)";
               }
               return "white";
            });

      // visualization is laid out. now fade out the wait and fade in viz
      $("#wait").hide();
      $("svg").fadeIn();

      // restart force layout
      force.nodes(nodes).links(links).start();
   }

   function isLeaf(d) {
      return (d.type=="archive" || d.type==="subfacet");
   }
   function isNoData(d) {
      return (isLeaf(d) && !d.size);
   }
   function isParent(d) {
      return (d.collapsedChildren || d.children );
   }

   function tick() {
      link.attr("x1", function(d) {
         return d.source.x;
      }).attr("y1", function(d) {
         return d.source.y;
      }).attr("x2", function(d) {
         return d.target.x;
      }).attr("y2", function(d) {
         return d.target.y;
      });

      node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")";});
   }

   function isFixed(d) {
      return d.fixed;
   }

   function commaSeparateNumber(val) {
      if ( val ) {
         while (/(\d+)(\d{3})/.test(val.toString())) {
            val = val.toString().replace(/(\d+)(\d{3})/, '$1' + ',' + '$2');
         }
      }
      return val;
   }


   function showPopupMenu(d) {
      function initMenu(d) {
         var collapsed = false;
         $("#expand").hide();
         $("#collapse").hide();
         if (d.children) {
            $("#collapse").show();
         } else if (d.collapsedChildren) {
            $("#expand").show();
            collapsed = true;
         }
         $("#menu").data("target", d);

         $("#unpin").show();
         $("#pin").hide();
         if (!d.fixed) {
            $("#unpin").hide();
            $("#pin").show();
         }
         $("#genre").hide();
         $("#discipline").hide();
         $("#doc_type").hide();

         // can this type of node have facet menu items?
         if (!collapsed && d.size && (d.type === "archive" || d.type === "subfacet")) {
            // reset any highlights, and figure out which items
            // to show and which should be highlighted. Loop over the facets
            $("#menu").find("input[type='checkbox']").prop('checked', false);
            var facets = ["doc_type", "discipline", "genre"];
            $.each(facets, function(idx, val) {
               // If this node has an ancestor of the facet type, do NOT show it
               if (hasAncestorFacet(d, val) === false) {
                  $("#" + val).show();
                  if (d.choice === val) {
                     $("#" + val).find("input[type='checkbox']").prop('checked', true);
                  }
               }
            });
            $("#menu hr").show();
         } else {
            $("#menu hr").hide();
         }
      }

      // clear the highlight on prior selection
      var oldD = $("#menu").data("target");
      if (oldD) {
         d3.select("#circle-" + oldD.id).classed("menu", false);
      }

      if (d.facet) {
         var f = d.facet;
         if ( f === "doc_type" ) {
            f = "format";
         }
         $("#title-label").text(f.charAt(0).toUpperCase() + f.slice(1) + ":");
      } else {
         $("#title-label").text("Title:");
      }

      $("#info .title").text(d.name);
      $("#info .size").text(commaSeparateNumber(d.size));
      //if ($("#menu").is(":visible") === false) {
         $("#menu").css({
            "top" : (d.y + 40) * scale + transY + "px",
            "left" : (d.x + 10) * scale + transX + "px"
         });
      //}
      initMenu(d);
      $("#menu").fadeIn();
      d3.select("#circle-" + d.id).classed("menu", true);
   }

   /**
    * Mouse over a node; trigger menu popup timer
    * @param {Object} d
    */

   function onMouseOver(d) {

      function isMenuVisible(d) {
         if ($("#menu").is(":visible") === false) {
            return false;
         }
         return ($("#menu").data("target") === d);
      }

      if (dragging === false && isMenuVisible(d) === false) {
         tipX = d3.event.pageX + 10;
         tipY = d3.event.pageY + 10;
         if ($("#menu").is(":visible")) {
            // menu already visible - just update content
            showPopupMenu(d);
         } else {
            if (tipShowTimer === -1) {
               tipShowTimer = setTimeout(function() {
                  showPopupMenu(d);
               }, 400);
            }
         }
      }
   }

   /**
    * Mouse left a node; kill menu popup timer
    * @param {Object} d
    */
   function onMouseLeave(d) {
      if (tipShowTimer !== -1) {
         clearTimeout(tipShowTimer);
         tipShowTimer = -1;
      }
   }

   // Check if this node has an ancestor of the specified facet
   var hasAncestorFacet = function(d, facet) {
      if ( d.other_facets ) {
         var others = d.other_facets;
         if ( facet === "genre" && others.genre ) {
            return true;
         }
         if ( facet === "discipline" && others.discipline ) {
            return true;
         }
         if ( facet === "doc_type" && others.doc_type ) {
            return true;
         }
      }
      return (d.facet === facet);
   };

   /**
    * Node clicked. Pin it and pop the menu immediately
    * @param {Object} d
    */
   function click(d) {
      if (!d3.event.defaultPrevented) {
         d.fixed = true;
         d3.select("#circle-" + d.id).classed("fixed", true);
         d3.event.stopPropagation();
         showPopupMenu(d);
      }
   }

   // Returns a list of all nodes under the root.
   function flatten(root) {
      var nodes = [], i = lastId;

      function recurse(node) {
         node.size = parseInt(node.size, 10);
         if (node.children) {
            node.children.forEach(recurse);
         }
         if (!node.id) {
            node.id = ++i;
            lastId = node.id;
         }
         nodes.push(node);
      }

      recurse(root);
      return nodes;
   }

});